// Deterministic frame renderer: drives window.seek(t) in headless Chromium and pipes frames to ffmpeg.
// usage: node src/render.mjs [--stills t1,t2,...] [--workers 4] [--from s] [--to s]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] ?? true]] : a), []));
const FPS = 30;
const WORKERS = parseInt(args.workers || '4', 10);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/src/index.html`;

async function openPage() {
  const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(URL_);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
  return { browser, page };
}

const { browser: b0, page: p0 } = await openPage();
const info = await p0.evaluate(() => window.getEvents());
fs.writeFileSync(path.join(BUILD, 'events.json'), JSON.stringify(info, null, 1));

if (args.stills) {
  fs.mkdirSync(path.join(BUILD, 'stills'), { recursive: true });
  for (const t of String(args.stills).split(',').map(Number)) {
    await p0.evaluate(t => window.seek(t), t);
    await p0.screenshot({ path: path.join(BUILD, 'stills', `t${t.toFixed(2)}.png`) });
    console.log('still', t);
  }
  await b0.close(); server.close(); process.exit(0);
}
await b0.close();

const from = parseFloat(args.from || '0'), to = parseFloat(args.to || String(info.duration));
const f0 = Math.round(from * FPS), f1 = Math.ceil(to * FPS);
const total = f1 - f0, per = Math.ceil(total / WORKERS);
fs.mkdirSync(path.join(BUILD, 'seg'), { recursive: true });
const t0 = Date.now();
let done = 0;

async function worker(k) {
  const a = f0 + k * per, b = Math.min(f1, a + per);
  if (a >= b) return null;
  const { browser, page } = await openPage();
  const out = path.join(BUILD, 'seg', `seg${k}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-threads', '1', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    done++;
    if (done % 60 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`${done}/${total} frames  ${el.toFixed(0)}s  eta ${(el / done * (total - done)).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  return out;
}

const segs = (await Promise.all([...Array(WORKERS).keys()].map(worker))).filter(Boolean);
fs.writeFileSync(path.join(BUILD, 'seg', 'list.txt'), segs.map(s => `file '${s}'`).join('\n'));
await new Promise(r => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(BUILD, 'seg', 'list.txt'), '-c', 'copy', path.join(BUILD, 'video_noaudio.mp4')], { stdio: 'inherit' }).on('close', r));
console.log('video done in', ((Date.now() - t0) / 1000).toFixed(0), 's');
server.close();

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ------------------------------------------------------------------ timeline */
const TL = await (await fetch('/build/timeline.json')).json();
const SC = {};
TL.scenes.forEach((s, i) => {
  s.i = i; s.end = s.start + s.dur; SC[s.id] = s;
  // weighted char positions: punctuation counts as a pause
  const cw = []; let acc = 0;
  for (const ch of s.text) { cw.push(acc); acc += ',.?!'.includes(ch) ? 9 : 1; }
  s.cw = cw; s.tot = acc;
});
const DUR = TL.duration;

/* --------------------------------------------------------------------- utils */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const eo3 = x => 1 - Math.pow(1 - x, 3);
const eoX = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const eio = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eoB = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const hash = (a, b) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };
const hashStr = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const $ = id => document.getElementById(id);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PX = 2 * 14 * Math.tan(THREE.MathUtils.degToRad(17.5)) / 1080; // world units per px at z=0
const wx = px => (px - 960) * PX, wy = py => -(py - 540) * PX;

function findWord(text, word, pos) {
  const clean = word.replace(/[^A-Za-z0-9'-]/g, '');
  if (!clean) return -1;
  const e = s => s.replace(/[-]/g, '\\-');
  let re = new RegExp('\\b' + e(clean) + '\\b', 'ig'); re.lastIndex = pos;
  let m = re.exec(text);
  if (!m) { re = new RegExp('\\b' + e(clean.slice(0, Math.min(clean.length, 5))), 'ig'); re.lastIndex = pos; m = re.exec(text); }
  return m && m.index - pos < 70 ? m.index : -1;
}
const tIdx = (s, i) => s.voStart + s.voDur * (s.cw[i] / s.tot) - 0.06;
function wt(id, phrase) {
  const s = SC[id]; const i = s.text.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) throw new Error('phrase not found: ' + id + ' / ' + phrase);
  return tIdx(s, i);
}

/* -------------------------------------------------------------------- events */
const EV = { key: [], space: [], whoosh: [], impact: [], pop: [], glitch: [], tick: [], riser: [], boom: [] };
const ev = (type, t, x) => EV[type].push(x ? { t, ...x } : { t });
window.getEvents = () => ({ duration: DUR, events: EV, scenes: TL.scenes.map(s => ({ id: s.id, start: s.start, end: s.end })) });

/* ----------------------------------------------------------- text animators */
const KIN = {};
function kin(id, times) {
  const el = $(id); const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words.map(w => `<span class="w"><span class="wi">${esc(w)}</span></span>`).join(' ');
  KIN[id] = { inner: [...el.querySelectorAll('.wi')], ts: words.map((w, i) => (typeof times === 'function' ? times(i, w) : times[i])) };
  return KIN[id];
}
function kinSync(id, sceneId, startPhrase) {
  const s = SC[sceneId]; const words = $(id).textContent.trim().split(/\s+/);
  let pos = startPhrase ? s.text.toLowerCase().indexOf(startPhrase.toLowerCase()) : 0;
  const ts = []; let last = null;
  words.forEach(w => {
    const i = findWord(s.text, w, pos);
    if (i >= 0) { pos = i + 1; last = tIdx(s, i); ts.push(last); }
    else { ts.push(last == null ? null : (last += 0.12)); }
  });
  for (let i = ts.length - 1; i >= 0; i--) if (ts[i] == null) ts[i] = (ts[i + 1] ?? s.voStart) - 0.12;
  return kin(id, ts);
}
function kinStag(id, t0, st = 0.09) { return kin(id, i => t0 + i * st); }
function kinU(id, t) {
  const k = KIN[id];
  k.inner.forEach((el, i) => {
    const p = eoX(ramp(t, k.ts[i], k.ts[i] + 0.55));
    el.style.transform = p >= 1 ? '' : `translateY(${(1 - p) * 140}%) rotate(${(1 - p) * 7}deg)`;
  });
}

const TY = {};
function typer(id, segs, t0, cps = 24, o = {}) {
  if (typeof segs === 'string') segs = [[segs, '']];
  const full = segs.map(s => s[0]).join('');
  const r = mulberry(hashStr(id)); const times = []; let t = t0;
  for (const ch of full) {
    times.push(t);
    if (!o.silent) ev(ch === ' ' || ch === '\n' ? 'space' : 'key', t);
    t += (1 / cps) * (0.55 + 0.9 * r()) + (ch === '\n' ? 0.16 : 0) + ('.,?:'.includes(ch) ? 0.1 : 0);
  }
  TY[id] = { el: $(id), segs, times, end: t, cursor: o.cursor ?? true, hold: o.hold ?? 1.0, last: '' };
  return t;
}
function tyU(id, t) {
  const y = TY[id]; let n = 0; while (n < y.times.length && y.times[n] <= t) n++;
  const typing = t >= y.times[0] && t < y.end + 0.05;
  const cur = y.cursor && t >= y.times[0] - 0.25 && t < y.end + y.hold && (typing || Math.floor(t * 2.5) % 2 === 0);
  const key = n + '|' + cur; if (key === y.last) return; y.last = key;
  let html = '', left = n;
  for (const [txt, cls] of y.segs) {
    if (left <= 0) break; const part = txt.slice(0, left); left -= part.length;
    html += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
  }
  y.el.innerHTML = html + (cur ? '<span class="cur"></span>' : '');
}

const SCR = {}; const GLY = '#%&*+=/<>01ABXZ$@';
function scramble(id, text, t0, dur = 0.8) {
  SCR[id] = { el: $(id), text, t0, dur };
  for (let t = t0; t < t0 + dur; t += 0.06) ev('tick', t);
}
function scrU(id, t) {
  const s = SCR[id]; const L = s.text.length; let html = '';
  for (let i = 0; i < L; i++) {
    const si = s.t0 + s.dur * 0.45 * (i / L), ri = s.t0 + s.dur * (0.35 + 0.65 * (i + 1) / L);
    if (t < si) break;
    if (t < ri) html += `<span style="color:var(--blue2)">${esc(GLY[Math.floor(hash(i, Math.floor(t * 24)) * GLY.length)])}</span>`;
    else html += esc(s.text[i]);
  }
  s.el.innerHTML = html;
}

function glitch(el, a, t) {
  if (a <= 0.01) { el.style.textShadow = ''; el.style.transform = ''; el.style.clipPath = ''; return; }
  const k = Math.floor(t * 30); const dx = (hash(k, 1) - 0.5) * 34 * a + 6 * a;
  el.style.textShadow = `${dx}px 0 rgba(255,46,67,.9), ${-dx}px 0 rgba(31,75,255,.9)`;
  el.style.transform = `translate(${(hash(k, 2) - 0.5) * 26 * a}px,${(hash(k, 3) - 0.5) * 8 * a}px) skewX(${(hash(k, 4) - 0.5) * 14 * a}deg)`;
  if (hash(k, 5) < 0.45 * a) { const top = hash(k, 6) * 60; el.style.clipPath = `inset(${top}% 0 ${hash(k, 7) * (90 - top)}% 0)`; }
  else el.style.clipPath = '';
}
const pop = (el, p, from = 0.6) => { el.style.opacity = clamp(p * 1.6); el.style.transform = `translateY(${(1 - p) * 30}px) scale(${lerp(from, 1, p)})`; };

/* --------------------------------------------------------------- shakes etc */
const SHAKES = [];
const shake = (t, amp) => SHAKES.push({ t, amp });
function shakeAt(t) {
  let x = 0, y = 0;
  for (const s of SHAKES) {
    const d = t - s.t; if (d < 0 || d > 0.6) continue;
    const a = s.amp * Math.exp(-d * 9);
    x += Math.sin(d * 90 + s.t) * a; y += Math.cos(d * 77 + s.t * 2) * a;
  }
  return { x, y };
}

/* -------------------------------------------------------------------- three */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(1920, 1080, false); renderer.setClearColor(0xffffff, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 200);
camera.position.set(0, 0, 14);
scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe5f7, 0.7));
const keyL = new THREE.DirectionalLight(0xffffff, 1.7); keyL.position.set(5, 8, 10); scene.add(keyL);
const rimL = new THREE.DirectionalLight(0x9fb4ff, 1.2); rimL.position.set(-8, -2, -6); scene.add(rimL);

const C = { ink: 0x0b0c16, blue: 0x1f4bff, red: 0xff2e43, gray: 0x9aa0b4 };
const M = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.26, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, ...o });
const B = (color, o = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, ...o });
function fade(g, a) {
  g.visible = a > 0.002;
  if (!g.visible) return;
  g.traverse(o => { if (o.material) { o.material.opacity = a * (o.userData.op ?? 1); o.material.transparent = o.material.opacity < 0.999 || !!o.userData.forceT; o.material.depthWrite = o.material.opacity > 0.6; } });
}
const add = (parent, o) => { parent.add(o); return o; };

// background particles
const dust = add(scene, new THREE.Group());
{
  const r = mulberry(11); const geos = [new THREE.BoxGeometry(1, 1, 1), new THREE.OctahedronGeometry(0.7), new THREE.TetrahedronGeometry(0.75)];
  const cols = [0xc9d3ff, 0xc9d3ff, 0xe1e4ec, 0xe1e4ec, 0xffcdd3, 0x1f4bff];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(geos[i % 3], M(cols[Math.floor(r() * cols.length)], { roughness: 0.5, clearcoat: 0 }));
    const s = 0.05 + r() * 0.13; m.scale.setScalar(s);
    m.userData = { x: (r() - 0.5) * 26, y: (r() - 0.5) * 15, z: -2 - r() * 14, sp: 0.1 + r() * 0.25, ph: r() * 6.28, rx: r() * 2, ry: r() * 2, op: 0.85 };
    dust.add(m);
  }
}

// logo
const LP = {
  L: [[183, 33], [20, 372], [178, 310], [122, 281], [183, 152]],
  R: [[218, 33], [218, 152], [279, 281], [223, 310], [381, 372]],
  Cn: [[200, 196], [166, 265], [200, 283], [235, 266]],
};
const logo = add(scene, new THREE.Group());
const logoPieces = {};
for (const [k, pts] of Object.entries(LP)) {
  const P = pts.map(([x, y]) => new THREE.Vector2((x - 200.5) / 100, -(y - 203) / 100));
  const cx = P.reduce((a, p) => a + p.x, 0) / P.length, cy = P.reduce((a, p) => a + p.y, 0) / P.length;
  const sh = new THREE.Shape(P.map(p => new THREE.Vector2(p.x - cx, p.y - cy)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.035, bevelSegments: 4, curveSegments: 1 });
  g.translate(0, 0, -0.21); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, k === 'Cn' ? M(C.blue) : M(C.ink));
  mesh.userData.base = new THREE.Vector3(cx, cy, 0);
  logo.add(mesh); logoPieces[k] = mesh;
}
const orbits = add(scene, new THREE.Group());
const orb1 = add(orbits, new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.018, 8, 160), B(C.blue)));
const orb2 = add(orbits, new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.012, 8, 160), B(C.red)));
const orbDot = add(orbits, new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), B(C.blue)));
const orbDot2 = add(orbits, new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), B(C.red)));

// shockwave rings
const RINGS = [];
function ring(t0, x, y, color, size = 4, dur = 0.9) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 128), B(color, { side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, y, 0.5); m.visible = false; scene.add(m); RINGS.push({ m, t0, size, dur });
}
function ringsU(t) {
  for (const r of RINGS) {
    const p = (t - r.t0) / r.dur;
    r.m.visible = p >= 0 && p <= 1; if (!r.m.visible) continue;
    r.m.scale.setScalar(0.2 + eoX(p) * r.size);
    r.m.material.opacity = (1 - p) * 0.9;
    const th = 1 - (0.025 + 0.11 * (1 - p)) / (0.2 + eoX(p) * r.size);
    r.m.geometry.dispose(); r.m.geometry = new THREE.RingGeometry(clamp(th, 0.3, 0.997), 1, 128);
  }
}

// DeFi ring
const defiG = add(scene, new THREE.Group());
const defiIn = add(defiG, new THREE.Group());
const cubes = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.72, 0.72, 4, 0.12), M(C.blue));
  const a = (i / 8) * Math.PI * 2; m.position.set(Math.cos(a) * 3, Math.sin(a) * 3, 0); defiIn.add(m); cubes.push(m);
}
const bank = add(defiG, new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.3, 1.3, 4, 0.16), M(C.ink)));
const shards = [];
{
  const r = mulberry(3);
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12 + r() * 0.12), M(C.ink, { flatShading: true }));
    m.userData = { d: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(1.6 + r() * 2.2), rv: new THREE.Vector3(r() * 8, r() * 8, r() * 8) };
    defiG.add(m); shards.push(m);
  }
}
const pairs = []; for (let i = 0; i < 8; i++) { pairs.push([i, (i + 1) % 8]); if (i < 4) pairs.push([i, i + 4]); pairs.push([i, (i + 3) % 8]); }
const defiLines = add(defiIn, new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.blue, transparent: true })));
{
  const pos = new Float32Array(pairs.length * 6);
  pairs.forEach(([a, b], k) => { pos.set(cubes[a].position.toArray(), k * 6); pos.set(cubes[b].position.toArray(), k * 6 + 3); });
  defiLines.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  defiLines.userData.op = 0.55;
}

// chaos burst
const chaos = add(scene, new THREE.Group());
{
  const r = mulberry(21);
  const geos = [new THREE.TetrahedronGeometry(0.42), new THREE.OctahedronGeometry(0.4), new THREE.IcosahedronGeometry(0.36), new RoundedBoxGeometry(0.55, 0.55, 0.55, 3, 0.08), new THREE.TorusGeometry(0.3, 0.1, 12, 32)];
  const cols = [C.blue, C.red, C.ink, C.blue, C.red];
  for (let i = 0; i < 30; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], M(cols[Math.floor(r() * cols.length)], { flatShading: i % 5 < 3 }));
    const ang = r() * Math.PI * 2;
    m.userData = { d: new THREE.Vector3(Math.cos(ang) * (3 + r() * 9) + 3, Math.sin(ang) * (2 + r() * 4.5), (r() - 0.3) * 6), rv: new THREE.Vector3(r() * 4 - 2, r() * 4 - 2, r() * 4 - 2), s: 0.7 + r() * 0.9, dl: r() * 0.25 };
    chaos.add(m);
  }
}

// evaluator (AI core)
const evalG = add(scene, new THREE.Group());
const evalWire = add(evalG, new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 1), B(C.blue, { wireframe: true })));
evalWire.userData.op = 0.75;
const evalCore = add(evalG, new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), M(C.blue, { flatShading: true })));
const evalOrb = add(evalG, new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.014, 8, 140), B(C.ink))); evalOrb.userData.op = 0.6;
const chainCube = add(scene, new THREE.Mesh(new RoundedBoxGeometry(1.25, 1.25, 1.25, 4, 0.15), M(C.ink)));

// model nodes
const models = add(scene, new THREE.Group());
const modelS = [], modelH = [];
[-4.49, 0, 4.49].forEach((x, i) => {
  const s = add(models, new THREE.Mesh(new THREE.SphereGeometry(0.55, 48, 32), M(C.ink)));
  s.position.set(x, 0.85, 0); modelS.push(s);
  const h = add(models, new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.025, 8, 100), B([C.blue, C.red, C.ink][i])));
  h.position.copy(s.position); modelH.push(h);
});

// validators
const valG = add(scene, new THREE.Group());
const valIn = add(valG, new THREE.Group());
const leader = add(valIn, new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), M(C.blue)));
const vals = [], vPulse = [];
for (let i = 0; i < 5; i++) {
  const a = Math.PI / 2 + (i / 5) * Math.PI * 2;
  const m = add(valIn, new THREE.Mesh(new THREE.SphereGeometry(0.36, 40, 28), M(C.ink)));
  m.position.set(Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0); vals.push(m);
  vPulse.push(add(valIn, new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), B(C.blue))));
}
const valLines = add(valIn, new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.gray, transparent: true })));
{
  const pos = []; vals.forEach((v, i) => { pos.push(0, 0, 0, ...v.position.toArray()); pos.push(...v.position.toArray(), ...vals[(i + 1) % 5].position.toArray()); });
  valLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); valLines.userData.op = 0.7;
}

// stream (why)
const stream = add(scene, new THREE.Group());
{
  const r = mulberry(5);
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.15), M(i % 7 === 0 ? C.red : i % 3 === 0 ? C.ink : C.blue));
    m.userData = { x0: r() * 40, y: (r() - 0.5) * 12, z: -8 - r() * 8, s: 0.2 + r() * 0.3, sp: 1.2 + r() * 1.5, rv: r() * 2, op: 0.55 };
    stream.add(m);
  }
}

// risk octahedron
const riskG = add(scene, new THREE.Group());
const riskWire = add(riskG, new THREE.Mesh(new THREE.OctahedronGeometry(2.0, 0), B(C.red, { wireframe: true })));
const riskCore = add(riskG, new THREE.Mesh(new THREE.OctahedronGeometry(1.05, 0), M(C.ink, { flatShading: true })));
const riskWire2 = add(riskG, new THREE.Mesh(new THREE.OctahedronGeometry(2.6, 0), B(C.ink, { wireframe: true })));
riskWire2.userData.op = 0.25;

// tunnel (future)
const tunnel = add(scene, new THREE.Group());
const TUN = [];
for (let i = 0; i < 24; i++) {
  const sq = i % 3 === 1;
  const g = sq ? new THREE.TorusGeometry(4.2, 0.03, 4, 4) : new THREE.TorusGeometry(3.8, 0.022, 6, 140);
  const m = add(tunnel, new THREE.Mesh(g, B(i % 8 === 5 ? C.red : sq ? C.ink : C.blue)));
  TUN.push(m);
}

/* ------------------------------------------------------------ scene setup */
const S = SC;
const WIPES = [S.defi.start, S.genlayer.start, S.future.start, S.outro.start];
WIPES.forEach(t => { ev('whoosh', t - 0.35, { big: 1 }); });

// 01 hook
typer('hookKick', 'The big question', S.hook.start + 1.9, 26);
kinSync('hook1', 'hook'); kinSync('hook2', 'hook'); kinSync('hook3', 'hook', 'predefined');
const HOOK_SNAP = 1.45;
ev('riser', 0.05, { dur: HOOK_SNAP - 0.05 }); ev('whoosh', 0.2); ev('whoosh', 0.55);
ev('boom', HOOK_SNAP); shake(HOOK_SNAP, 10); ring(HOOK_SNAP, 0, 0, C.blue, 7, 1.1); ring(HOOK_SNAP + 0.1, 0, 0, C.red, 5, 1.0);
const tHl = wt('hook', 'predefined'); ev('pop', tHl + 0.1);

// 02 defi
typer('defiKick', 'Decentralized finance', S.defi.start + 0.45, 30);
kinStag('defi1', wt('defi', 'removed') - 0.05, 0.16);
kinStag('defi2', wt('defi', 'opened') , 0.14);
const tDefiB = wt('defi', 'But one');
kinSync('defi3', 'defi', 'But one'); kinSync('defi4', 'defi', 'limitation'); kinSync('defi5', 'defi', 'remains');
const tLim = wt('defi', 'limitation');
const tBank = wt('defi', 'intermediaries');
ev('impact', tBank, { soft: 1 }); shake(tBank, 4); ev('glitch', tLim); shake(tLim, 7);
ev('whoosh', S.defi.start + 0.4);

// 03 rules
const CODE = [['function ', 'k'], ['settle', 'f'], ['() ', ''], ['public', 'k'], [' {\n  ', ''], ['if', 'k'], [' (price < ', ''], ['1800', 'n'], [') {\n    ', ''], ['liquidate', 'f'], ['(position);\n  }\n}', '']];
typer('codeBody', CODE, S.rules.start + 0.55, 27, { hold: 0.6 });
typer('rulesKick', 'Smart contracts', S.rules.start + 0.5, 28, { cursor: false });
kinStag('rules1', wt('rules', 'Most smart'), 0.1);
kinStag('rules2', wt('rules', 'defined in advance'), 0.12);
const tChaos = wt('rules', 'And the real world');
kinSync('rules3', 'rules', 'the real world'); kinSync('rules4', 'rules', 'rarely');
const tPred = wt('rules', 'predictable');
typer('codeErr', 'ERROR: condition not defined', tChaos + 0.6, 34, { cursor: false });
ev('boom', tChaos, { soft: 1 }); ev('glitch', tChaos + 0.02); ev('whoosh', tChaos); shake(tChaos, 12);
ev('whoosh', S.rules.start + 0.1);
{ const el = $('rulesWob'); el.innerHTML = [...el.textContent].map(c => `<span style="display:inline-block">${c}</span>`).join(''); }

// 04 imagine
typer('imKick', 'Imagine', S.imagine.start + 0.35, 20, { cursor: false });
kinSync('im1', 'imagine', 'a protocol');
const IM_WORDS = [['numbers.', 'numbers'], ['news.', 'news articles'], ['websites.', 'websites'], ['the real world.', 'real-world conditions']];
const imT = IM_WORDS.map(([, p]) => wt('imagine', p));
$('imSlot').innerHTML = `<div style="position:relative;height:110px;overflow:hidden">${IM_WORDS.map(([w], i) => `<div id="imW${i}" class="${i === 3 ? 'red' : ''}" style="position:absolute;left:0;right:0;top:0">${w}</div>`).join('')}</div>`;
imT.forEach(t => { ev('pop', t); ev('whoosh', t - 0.15, { soft: 1 }); });
const IC_POS = [[170, 430], [1360, 430], [170, 720], [1360, 720]];
const EVAL_C = [960, 600];
{
  const svg = $('imLines'); let h = '';
  IC_POS.forEach(([x, y], i) => {
    const sx = x < 960 ? x + 390 : x, sy = y + 70;
    h += `<path id="iml${i}" d="M${sx},${sy} C${(sx + EVAL_C[0]) / 2},${sy} ${(sx + EVAL_C[0]) / 2},${EVAL_C[1]} ${EVAL_C[0]},${EVAL_C[1]}" fill="none" stroke="${i === 3 ? '#FF2E43' : '#1F4BFF'}" stroke-width="3" stroke-linecap="round"/>`;
    h += `<circle id="imd${i}" r="7" fill="${i === 3 ? '#FF2E43' : '#1F4BFF'}"/>`;
  });
  svg.innerHTML = h;
}

// 05 ai x chain
typer('acKick', 'This is where', S.aichain.start + 0.35, 26, { cursor: false });
const tAI = wt('aichain', 'AI'), tBC = wt('aichain', 'blockchain'), tSlam = tBC + 0.28;
ev('whoosh', tAI - 0.1); ev('whoosh', tBC - 0.1); ev('boom', tSlam); shake(tSlam, 14);
ring(tSlam, 0, 1.6, C.blue, 8, 1.1); ring(tSlam + 0.08, 0, 1.6, C.red, 6, 1.0); ring(tSlam + 0.16, 0, 1.6, C.ink, 4.5, 0.9);

// 06 genlayer
typer('glKick', 'Introducing', S.genlayer.start + 0.5, 24, { cursor: false });
scramble('glName', 'GenLayer', S.genlayer.start + 0.65, 0.9);
kinSync('gl1', 'genlayer', 'Intelligent Contracts');
const tCh = [wt('genlayer', 'AI models'), wt('genlayer', 'complex conditions'), wt('genlayer', 'real world')];
tCh.forEach(t => ev('pop', t));
ev('impact', S.genlayer.start + 0.6, { soft: 1 });

// 07 problem
ev('pop', S.problem.start + 0.3);
const tDiff = wt('problem', 'interpret');
const pbT = [tDiff, tDiff + 0.55, tDiff + 1.1];
typer('pbB0', '→ TRUE', pbT[0], 16, { cursor: false });
typer('pbB1', '→ FALSE', pbT[1], 16, { cursor: false });
typer('pbB2', '→ UNCLEAR', pbT[2], 16, { cursor: false });
kinSync('pb1', 'problem', 'how does'); kinSync('pb2', 'problem', 'without'); kinSync('pb3', 'problem', 'single');
const tStrike = wt('problem', 'authority') + 0.45; ev('glitch', tStrike, { soft: 1 });
[0, 1, 2].forEach(i => ev('pop', S.problem.start + 0.4 + i * 0.12));

// 08 consensus
typer('csKick', 'GenLayer consensus', S.consensus.start + 0.35, 28);
scramble('csName1', 'Optimistic', wt('consensus', 'Optimistic') - 0.2, 0.7);
scramble('csName2', 'Democracy.', wt('consensus', 'Democracy') - 0.15, 0.7);
const tSt = [wt('consensus', 'consensus mechanism'), wt('consensus', 'validator evaluations'), wt('consensus', 'resolving')];
tSt.forEach(t => ev('pop', t));
const tRes = tSt[2] + 0.75; ev('boom', tRes, { soft: 1 }); ring(tRes, 4.0, -0.1, C.blue, 5, 1.0); shake(tRes, 5);
ring(tSt[2], 4.0 + Math.cos(Math.PI / 2 + 2 / 5 * 2 * Math.PI) * 2.4 * 0.95, -0.1 + Math.sin(Math.PI / 2 + 2 / 5 * 2 * Math.PI) * 2.4 * 0.95, C.red, 1.6, 0.7);
ev('glitch', tSt[1] + 0.55, { soft: 1 });

// 09 why
kinSync('why1', 'why', 'why does'); kinSync('why2', 'why', 'DeFi');
const tFc = [wt('why', 'Apps that interpret'), wt('why', 'respond to'), wt('why', 'in entirely new')];
tFc.forEach(t => { ev('whoosh', t - 0.1, { soft: 1 }); ev('pop', t + 0.15); });

// 10 risks
typer('rkKick', '// Considerations', S.risks.start + 0.4, 26);
kinSync('rk0', 'risks', 'challenges remain');
const tRk = [wt('risks', 'Security'), wt('risks', 'Data reliability'), wt('risks', 'Execution costs'), wt('risks', 'unpredictability')];
tRk.forEach(t => { ev('impact', t, { soft: 1 }); shake(t, 4); });

// 11 future
kinSync('fu1', 'future', 'the future'); kinSync('fu2', 'future', 'limited'); kinSync('fu3', 'future', 'predefined');
const tFStrike = wt('future', 'rules') + 0.45; ev('glitch', tFStrike, { soft: 1 });
const tFuB = wt('future', 'And GenLayer');
typer('fuKick', 'Beyond predefined rules', tFuB - 0.1, 30, { cursor: false });
kinSync('fu4', 'future', 'GenLayer'); kinSync('fu5', 'future', 'that direction');
ev('whoosh', tFuB - 0.2);

// 12 outro
kinSync('ot1', 'outro', 'could'); kinSync('ot2', 'outro', 'unlock'); kinSync('ot3', 'outro', 'DeFi');
const tPA = wt('outro', 'unlock'), tPB = wt('outro', 'Or are');
ev('whoosh', tPA); ev('whoosh', tPB);
const tEnd = wt('outro', 'Tell us') - 0.35;
ev('whoosh', tEnd - 0.2, { big: 1 }); ev('boom', tEnd + 0.45); ring(tEnd + 0.45, 0, 1.45, C.blue, 7, 1.2); ring(tEnd + 0.55, 0, 1.45, C.red, 5, 1.1);
scramble('otName', 'GenLayer', tEnd + 0.55, 0.85);
typer('otCta', 'What do you think? Reply below ↓', tEnd + 1.25, 24, { hold: 99 });

/* ----------------------------------------------------------------- update */
const E_last = {};
const sceneEls = {}; TL.scenes.forEach(s => (sceneEls[s.id] = $('s-' + s.id)));
const hardIn = new Set(['defi', 'genlayer', 'future', 'outro']);
const hardOut = new Set(['hook', 'aichain', 'risks', 'future']);
function envOf(s, t) {
  const fin = hardIn.has(s.id) ? 0.02 : 0.4, fout = hardOut.has(s.id) ? 0.02 : 0.38;
  const a = ramp(t, s.start - (hardIn.has(s.id) ? 0 : 0.15), s.start + fin);
  const b = 1 - ramp(t, s.end - fout, s.end + (hardOut.has(s.id) ? 0 : 0.1));
  return { a, b, e: Math.min(a, b) };
}

function placeLogo(t) {
  const s1 = S.hook, s6 = S.genlayer, s12 = S.outro;
  let vis = 0;
  logo.rotation.set(0, 0, 0); logo.position.set(0, 0, 0); logo.scale.setScalar(1);
  const pc = logoPieces;
  for (const k in pc) { pc[k].position.copy(pc[k].userData.base); pc[k].rotation.set(0, 0, 0); }
  orbits.visible = false;
  if (t < s1.end) {
    vis = 1;
    const from = { L: [-9, 4, -8, 2.4], R: [9, -4, -8, -2.2], Cn: [0, -2, -34, 3.5] };
    const st = { L: 0.15, R: 0.3, Cn: 0.5 };
    for (const k in pc) {
      const p = eoX(ramp(t, st[k], HOOK_SNAP)); const [x, y, z, r] = from[k];
      pc[k].position.add(new THREE.Vector3(x * (1 - p), y * (1 - p), z * (1 - p)));
      pc[k].rotation.set(r * (1 - p), r * 1.3 * (1 - p), r * 0.7 * (1 - p));
    }
    const m = eio(ramp(t, 1.95, 2.7));
    logo.position.set(0, lerp(0, 1.75, m), 0); logo.scale.setScalar(lerp(1.25, 0.62, m) * (1 + 0.06 * Math.exp(-Math.max(0, t - HOOK_SNAP) * 7) * (t > HOOK_SNAP ? 1 : 0)));
    logo.rotation.y = t > HOOK_SNAP ? 0.35 * Math.sin((t - HOOK_SNAP) * 1.3) : 0;
    logo.rotation.x = -0.12 * m;
  } else if (t > s6.start - 0.05 && t < s6.end + 0.4) {
    vis = 1 - ramp(t, s6.end - 0.35, s6.end);
    const p = eoX(ramp(t, s6.start, s6.start + 1.3));
    logo.position.set(-4.0, -0.1, 0); logo.scale.setScalar(lerp(0.3, 1.1, p));
    logo.rotation.y = (1 - p) * -Math.PI * 2 + 0.45 * Math.sin((t - s6.start) * 0.9);
    logo.rotation.x = 0.1 * Math.sin((t - s6.start) * 0.7);
    orbits.visible = true; orbits.position.copy(logo.position); orbits.scale.setScalar(lerp(0.2, 0.9, eo3(ramp(t, s6.start + 0.3, s6.start + 1.4))));
    fade(orbits, vis);
  } else if (t > tEnd + 0.1) {
    vis = 1;
    const p = eoX(ramp(t, tEnd + 0.15, tEnd + 1.0));
    logo.position.set(0, 1.5, 0); logo.scale.setScalar(lerp(0.2, 0.92, p));
    logo.rotation.y = (1 - p) * Math.PI * 2 + 0.3 * Math.sin((t - tEnd) * 1.1);
    orbits.visible = true; orbits.position.copy(logo.position); orbits.scale.setScalar(lerp(0.2, 0.85, eo3(ramp(t, tEnd + 0.4, tEnd + 1.5))));
    fade(orbits, 1);
  }
  if (orbits.visible) {
    const u = t * 0.6;
    orb1.rotation.set(1.2 + 0.1 * Math.sin(u), 0.3, u * 0.3); orb2.rotation.set(1.35, -0.45, -u * 0.25);
    const a1 = t * 1.4, a2 = -t * 1.1;
    orbDot.position.set(Math.cos(a1) * 2.7, Math.sin(a1) * 2.7, 0).applyEuler(orb1.rotation);
    orbDot2.position.set(Math.cos(a2) * 3.15, Math.sin(a2) * 3.15, 0).applyEuler(orb2.rotation);
  }
  fade(logo, vis);
}

function update(t) {
  // shake
  const sh = shakeAt(t);
  $('ui').style.transform = sh.x || sh.y ? `translate(${sh.x}px,${sh.y}px)` : '';
  camera.position.set(0.08 * Math.sin(t * 0.23) - sh.x * PX, 0.06 * Math.sin(t * 0.31) + sh.y * PX, 14);
  camera.lookAt(camera.position.x, camera.position.y, 0);
  $('bg').style.transform = `translate(${(t * 6) % 48}px,${(t * 3) % 48}px)`;

  // scenes on/off
  const E = {};
  for (const s of TL.scenes) {
    const en = envOf(s, t); E[s.id] = en;
    const el = sceneEls[s.id];
    const on = en.e > 0.001;
    el.style.display = on ? 'block' : 'none';
    if (on) {
      el.style.opacity = en.e;
      const zin = (1 - eo3(en.a)) * 0.05, zout = (1 - en.b) * 0.06;
      el.style.transform = `scale(${1 + zin - zout})`;
      el.style.filter = en.b < 1 ? `blur(${(1 - en.b) * 10}px)` : '';
    }
  }
  const on = id => E[id].e > 0.001;
  for (const k in E) E_last[k] = E[k].e;

  // HUD
  const s = TL.scenes.find(x => t >= x.start && t < x.end) || TL.scenes[TL.scenes.length - 1];
  $('hud').style.opacity = ramp(t, 2.0, 2.6);
  $('hudN').textContent = String(s.i + 1).padStart(2, '0');
  $('hudL').textContent = s.id.toUpperCase();
  { const sec = Math.floor(t); $('hudT').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }

  // wipes
  {
    let p = -1; for (const w of WIPES) { const q = (t - (w - 0.5)) / 1.0; if (q >= 0 && q <= 1) p = q; }
    const x = p < 0 ? -9000 : lerp(-3700, 2800, eio(p));
    $('wipe1').style.transform = `translateX(${x}px) skewX(-16deg)`; $('wipe1').style.width = '3000px';
    $('wipe2').style.transform = `translateX(${x + 3060}px) skewX(-16deg)`; $('wipe2').style.width = '220px';
    $('wipe3').style.transform = `translateX(${x + 3340}px) skewX(-16deg)`;
  }

  /* --- DOM scenes --- */
  if (on('hook')) {
    tyU('hookKick', t); ['hook1', 'hook2', 'hook3'].forEach(k => kinU(k, t));
    $('hookHl').style.setProperty('--p', eoX(ramp(t, tHl - 0.05, tHl + 0.4)));
    const rp = ramp(t, HOOK_SNAP, HOOK_SNAP + 0.9), r = $('hookRing');
    r.style.opacity = rp > 0 && rp < 1 ? (1 - rp) : 0; const d = 40 + eoX(rp) * 1100;
    r.style.width = r.style.height = d + 'px'; r.style.left = 960 - d / 2 + 'px'; r.style.top = 540 - d / 2 + 'px';
  }
  if (on('defi')) {
    tyU('defiKick', t); ['defi1', 'defi2', 'defi3', 'defi4', 'defi5'].forEach(k => kinU(k, t));
    const o = eo3(ramp(t, tDefiB - 0.3, tDefiB));
    $('defiA').style.transform = `translateY(${-o * 80}px)`; $('defiA').style.opacity = 1 - o;
    $('defiA').style.filter = o > 0 ? `blur(${o * 8}px)` : '';
    $('defiB').style.opacity = t > tDefiB - 0.2 ? 1 : 0;
    const ga = Math.max(Math.exp(-Math.max(0, t - tLim) * 4) * (t >= tLim ? 1 : 0), (hash(Math.floor(t * 6), 9) > 0.85 && t > tLim + 0.6) ? 0.35 : 0);
    glitch($('defiGl'), ga, t);
  }
  if (on('rules')) {
    const sr = S.rules;
    tyU('codeBody', t); tyU('rulesKick', t); tyU('codeErr', t);
    const p = eo3(ramp(t, sr.start, sr.start + 1.0));
    const k = Math.exp(-Math.max(0, t - tChaos) * 5) * (t > tChaos ? 1 : 0);
    $('codeCard').style.transform = `translateX(${(1 - p) * -260 + Math.sin(t * 70) * 10 * k}px) rotateY(${lerp(50, 16, p) - (t > tChaos ? 5 * eo3(ramp(t, tChaos, tChaos + 0.8)) : 0)}deg) rotateX(4deg)`;
    $('codeCard').style.opacity = clamp(p * 1.5);
    $('codeCard').style.borderColor = t > tChaos ? `rgba(255,46,67,${0.3 + 0.7 * k})` : '';
    ['rules1', 'rules2', 'rules3', 'rules4'].forEach(k2 => kinU(k2, t));
    const o = eo3(ramp(t, tChaos - 0.35, tChaos - 0.05));
    $('rulesA').style.opacity = 1 - o; $('rulesA').style.transform = `translateY(${-o * 70}px)`;
    $('rulesB').style.opacity = t > tChaos - 0.2 ? 1 : 0;
    [...$('rulesWob').children].forEach((c, i) => {
      const ti = tPred + i * 0.035, pp = eoB(ramp(t, ti, ti + 0.45));
      const amp = 2.5 + 30 * (1 - eo3(ramp(t, ti, ti + 0.8)));
      c.style.opacity = clamp(pp * 2);
      c.style.transform = `translate(${Math.sin(t * 7 + i * 1.7) * amp * 0.5}px,${(1 - pp) * 60 + Math.cos(t * 6 + i * 2.3) * amp * 0.45}px) rotate(${Math.sin(t * 5 + i) * (amp * 0.5)}deg)`;
    });
  }
  if (on('imagine')) {
    tyU('imKick', t); kinU('im1', t);
    IM_WORDS.forEach((w, i) => {
      const tin = imT[i], tout = i < 3 ? imT[i + 1] : 1e9;
      const y = (1 - eoX(ramp(t, tin - 0.05, tin + 0.4))) * 140 - eoX(ramp(t, tout - 0.05, tout + 0.4)) * 140;
      $('imW' + i).style.transform = `translateY(${y}%)`;
    });
    IC_POS.forEach(([x, y], i) => {
      const p = eoB(ramp(t, imT[i] - 0.1, imT[i] + 0.55)), el = $('ic' + i);
      const dir = x < 960 ? -1 : 1;
      el.style.opacity = clamp(p * 1.4);
      el.style.transform = `perspective(1200px) translateX(${dir * (1 - p) * 300}px) translateY(${Math.sin(t * 1.6 + i) * 8}px) rotateY(${dir * -(1 - p) * 60 - dir * 10}deg) scale(${lerp(0.7, 1, p)})`;
      const path = $('iml' + i), L = path.getTotalLength(), lp = eo3(ramp(t, imT[i] + 0.2, imT[i] + 0.8));
      path.style.strokeDasharray = `${L}`; path.style.strokeDashoffset = `${L * (1 - lp)}`; path.style.opacity = 0.55;
      const dp = ((t - imT[i] - 0.8) * 0.9) % 1, dot = $('imd' + i);
      if (t > imT[i] + 0.8) { const pt = path.getPointAtLength(L * dp); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); dot.style.opacity = 1; } else dot.style.opacity = 0;
    });
  }
  if (on('aichain')) {
    tyU('acKick', t);
    const a = eoX(ramp(t, tAI - 0.12, tAI + 0.3)), b = eoX(ramp(t, tBC - 0.12, tBC + 0.3)), x = eoB(ramp(t, tSlam - 0.15, tSlam + 0.3));
    $('acAI').style.transform = `translateX(${(1 - a) * -1100}px) skewX(${(1 - a) * 20}deg)`; $('acAI').style.opacity = clamp(a * 3);
    $('acBC').style.transform = `translateX(${(1 - b) * 1300}px) skewX(${(1 - b) * -20}deg)`; $('acBC').style.opacity = clamp(b * 3);
    $('acX').style.transform = `scale(${x}) rotate(${(1 - x) * 180}deg)`; $('acX').style.opacity = clamp(x * 2);
    glitch($('acBC'), Math.exp(-Math.max(0, t - tSlam) * 6) * (t > tSlam ? 0.8 : 0), t);
  }
  if (on('genlayer')) {
    tyU('glKick', t); scrU('glName', t); kinU('gl1', t);
    $('glUl').style.width = eio(ramp(t, KIN.gl1.ts[1] + 0.3, KIN.gl1.ts[1] + 1.0)) * 100 + '%';
    tCh.forEach((tc, i) => pop($('ch' + i), eoB(ramp(t, tc - 0.05, tc + 0.45))));
  }
  if (on('problem')) {
    const sp = S.problem;
    pop($('pbIn'), eoB(ramp(t, sp.start + 0.25, sp.start + 0.7)));
    [0, 1, 2].forEach(i => { $('pbL' + i).style.opacity = ramp(t, sp.start + 0.4 + i * 0.12, sp.start + 0.8 + i * 0.12); tyU('pbB' + i, t); $('pbB' + i).style.visibility = t >= pbT[i] ? 'visible' : 'hidden'; });
    if (!$('pbLines').innerHTML) {
      $('pbLines').innerHTML = [411, 960, 1509].map((x, i) => `<path id="pbl${i}" d="M960,170 C960,215 ${x},205 ${x},252" fill="none" stroke="#1F4BFF" stroke-width="3" stroke-dasharray="6 8"/>`).join('');
    }
    [0, 1, 2].forEach(i => { const p = eo3(ramp(t, sp.start + 0.55, sp.start + 1.2)); const el = $('pbl' + i); el.style.opacity = p; el.style.strokeDashoffset = -t * 30; });
    ['pb1', 'pb2', 'pb3'].forEach(k => kinU(k, t));
    $('pbStrike').querySelector('i').style.width = eio(ramp(t, tStrike, tStrike + 0.4)) * 104 + '%';
    $('pbStrike').style.color = t > tStrike + 0.2 ? '#B9BECC' : '';
  }
  if (on('consensus')) {
    tyU('csKick', t); scrU('csName1', t); scrU('csName2', t);
    [0, 1, 2].forEach(i => {
      const el = $('st' + i), p = eo3(ramp(t, S.consensus.start + 0.9 + i * 0.15, S.consensus.start + 1.5 + i * 0.15));
      el.style.opacity = p; el.style.transform = `translateX(${(1 - p) * -40}px)`;
      const act = t >= tSt[i]; el.style.color = act ? 'var(--ink)' : '';
      const n = el.querySelector('.n'); n.style.background = act ? 'var(--blue)' : ''; n.style.borderColor = act ? 'var(--blue)' : ''; n.style.color = act ? '#fff' : '';
    });
    pop($('csOk'), eoB(ramp(t, tRes + 0.1, tRes + 0.55)));
  }
  if (on('why')) {
    kinU('why1', t); kinU('why2', t);
    tFc.forEach((tf, i) => {
      const p = eoB(ramp(t, tf - 0.1, tf + 0.6)), el = $('fc' + i);
      el.style.opacity = clamp(p * 2);
      el.style.transformOrigin = '50% 100%';
      el.style.transform = `translateY(${(1 - p) * 160 + Math.sin(t * 1.4 + i * 1.3) * 7}px) rotateX(${(1 - p) * -75}deg)`;
    });
  }
  if (on('risks')) {
    tyU('rkKick', t); kinU('rk0', t);
    tRk.forEach((tr, i) => {
      const p = eoX(ramp(t, tr - 0.06, tr + 0.35)), el = $('rk' + (i + 1));
      el.style.opacity = clamp(p * 2); el.style.transform = `translateX(${(1 - p) * -120}px) skewX(${(1 - p) * -18}deg)`;
      el.querySelector('.ln').style.width = eio(ramp(t, tr + 0.05, tr + 0.7)) * 100 + '%';
      el.querySelector('.t').style.color = t > tr && t < tr + 0.25 ? 'var(--red)' : '';
    });
  }
  if (on('future')) {
    ['fu1', 'fu2', 'fu3', 'fu4', 'fu5'].forEach(k => kinU(k, t)); tyU('fuKick', t);
    $('fuStrike').querySelector('i').style.width = eio(ramp(t, tFStrike, tFStrike + 0.45)) * 104 + '%';
    const o = eo3(ramp(t, tFuB - 0.4, tFuB - 0.1));
    $('fuA').style.opacity = 1 - o; $('fuA').style.transform = `translateY(${-o * 90}px)`; $('fuA').style.filter = o > 0 ? `blur(${o * 10}px)` : '';
    $('fuB').style.opacity = t > tFuB - 0.3 ? 1 : 0;
  }
  if (on('outro')) {
    ['ot1', 'ot2', 'ot3'].forEach(k => kinU(k, t));
    const pa = eoB(ramp(t, tPA, tPA + 0.6)), pb = eoB(ramp(t, tPB, tPB + 0.6));
    $('poA').style.opacity = clamp(pa * 2); $('poA').style.transform = `translateX(${(1 - pa) * -300}px) rotateY(${(1 - pa) * 50 + 8}deg) translateY(${Math.sin(t * 1.5) * 6}px)`;
    $('poB').style.opacity = clamp(pb * 2); $('poB').style.transform = `translateX(${(1 - pb) * 300}px) rotateY(${(1 - pb) * -50 - 8}deg) translateY(${Math.sin(t * 1.5 + 1) * 6}px)`;
    const o = eo3(ramp(t, tEnd - 0.1, tEnd + 0.35));
    $('otA').style.opacity = 1 - o; $('otA').style.transform = `scale(${1 - o * 0.12})`; $('otA').style.filter = o > 0 ? `blur(${o * 12}px)` : '';
    $('otB').style.opacity = t > tEnd ? 1 : 0;
    scrU('otName', t); tyU('otCta', t);
  }

  /* --- 3D --- */
  dust.children.forEach((m, i) => {
    const d = m.userData;
    m.position.set(d.x + Math.sin(t * d.sp + d.ph) * 0.6, d.y + Math.cos(t * d.sp * 0.8 + d.ph) * 0.4 + ((t * d.sp * 0.15) % 3), d.z);
    m.rotation.set(t * d.rx, t * d.ry, 0);
  });
  fade(dust, 1 - 0.6 * (on('future') ? E.future.e : 0));

  placeLogo(t);
  ringsU(t);

  // defi
  {
    const sd = S.defi, e = E.defi.e;
    fade(defiG, e);
    if (defiG.visible) {
      const u = t - sd.start, p = eoB(ramp(t, sd.start + 0.25, sd.start + 1.1));
      defiG.position.set(3.85, -0.15, 0); defiG.scale.setScalar(Math.max(0.001, p) * 0.9);
      defiG.rotation.set(-0.95, 0.25, 0);
      const jit = t > tLim && t < tLim + 0.5 ? (hash(Math.floor(t * 30), 3) - 0.5) * 0.25 : 0;
      defiIn.rotation.z = u * 0.32 + jit;
      cubes.forEach((c, i) => {
        c.rotation.set(t * 0.8 + i, t * 0.6 + i * 2, 0);
        const red = i === 2 ? eo3(ramp(t, tLim, tLim + 0.3)) : 0;
        c.material.color.setHex(C.blue).lerp(new THREE.Color(C.red), red);
        c.scale.setScalar(1 + (i === 2 ? 0.35 * red : 0));
      });
      const bp = ramp(t, tBank, tBank + 0.18);
      bank.scale.setScalar(Math.max(0.001, 1 - bp)); bank.rotation.set(t * 0.5, t * 0.7, 0);
      bank.visible = bp < 1;
      shards.forEach(m => {
        const q = eoX(ramp(t, tBank, tBank + 1.3)); m.visible = t > tBank && t < tBank + 1.4;
        m.position.copy(m.userData.d).multiplyScalar(q); m.rotation.set(m.userData.rv.x * q, m.userData.rv.y * q, m.userData.rv.z * q);
        m.scale.setScalar(1 - ramp(t, tBank + 0.6, tBank + 1.35));
      });
      const lp = eio(ramp(t, tBank + 0.2, tBank + 1.4));
      defiLines.geometry.setDrawRange(0, Math.floor(lp * pairs.length) * 2);
    }
  }
  // chaos
  {
    const e = E.rules.e * (t > tChaos ? 1 : 0); fade(chaos, e);
    if (chaos.visible) {
      chaos.children.forEach(m => {
        const d = m.userData, q = eoX(ramp(t, tChaos + d.dl * 0.3, tChaos + 1.8)), dt = t - tChaos;
        m.position.set(-3.6 + d.d.x * q + Math.sin(t + d.dl * 20) * 0.15, d.d.y * q + dt * 0.08, d.d.z * q - 1);
        m.rotation.set(d.rv.x * dt * 1.2, d.rv.y * dt * 1.2, d.rv.z * dt);
        m.scale.setScalar(d.s * eoB(ramp(t, tChaos, tChaos + 0.4)));
      });
    }
  }
  // evaluator + chain cube
  {
    const si = S.imagine, sa = S.aichain;
    const vis = Math.max(on('imagine') ? E.imagine.a : 0, 0) * (t < sa.start ? 1 : 0) + (t >= sa.start && t < sa.end ? E.aichain.b : 0);
    fade(evalG, vis);
    let x = 0, y = -0.5, sc = eoB(ramp(t, si.start + 0.1, si.start + 0.9));
    imT.forEach(ti => { sc *= 1 + 0.12 * Math.exp(-Math.max(0, t - ti - 0.4) * 6) * (t > ti + 0.4 ? 1 : 0); });
    let cubeV = 0, cx = 6, cy = 1.6, cs = 1;
    if (t >= sa.start - 0.4) {
      const m = eio(ramp(t, sa.start - 0.4, sa.start + 0.4));
      x = lerp(0, -2.3, m); y = lerp(-0.5, 1.6, m); sc *= lerp(1, 0.75, m);
      const ci = eoX(ramp(t, tBC - 0.1, tBC + 0.3)); cubeV = E.aichain.b * (t > tBC - 0.1 ? 1 : 0);
      cx = lerp(9, 2.3, ci);
      const mg = eoB(ramp(t, tSlam - 0.18, tSlam + 0.25));
      x = lerp(x, 0, mg); cx = lerp(cx, 0, mg); cs = lerp(1, 0.78, mg);
    }
    evalG.position.set(x, y, 0); evalG.scale.setScalar(Math.max(0.001, sc));
    const spin = t > tSlam ? 6 * Math.exp(-(t - tSlam) * 3) : 0;
    evalWire.rotation.set(t * 0.35, t * 0.5 + spin, 0); evalCore.rotation.set(-t * 0.6, t * 0.4 - spin, 0);
    evalOrb.rotation.set(1.25, 0.2, t * 0.8);
    fade(chainCube, cubeV); chainCube.position.set(cx, cy, 0); chainCube.scale.setScalar(cs);
    chainCube.rotation.set(t * 0.7 + spin, t * 0.9, 0.3);
  }
  // models
  {
    const sp = S.problem; fade(models, E.problem.e);
    if (models.visible) {
      modelS.forEach((m, i) => {
        const p = eoB(ramp(t, sp.start + 0.35 + i * 0.12, sp.start + 0.9 + i * 0.12));
        m.scale.setScalar(Math.max(0.001, p)); m.position.y = 0.85 + Math.sin(t * 1.8 + i) * 0.05;
        const c = [C.blue, C.red, C.ink][i], k = eo3(ramp(t, pbT[i], pbT[i] + 0.3));
        m.material.color.setHex(C.ink).lerp(new THREE.Color(c), k);
        const h = modelH[i]; h.position.copy(m.position);
        const hp = ramp(t, pbT[i], pbT[i] + 0.5);
        h.scale.setScalar(Math.max(0.001, eoB(hp))); h.rotation.set(1.1 + Math.sin(t + i) * 0.2, t * 0.8 + i, 0);
        h.userData.op = hp > 0 ? 1 : 0;
      });
    }
  }
  // validators
  {
    const sc = S.consensus; fade(valG, E.consensus.e);
    if (valG.visible) {
      valG.position.set(4.0, -0.1, 0); valG.rotation.set(-0.3, 0.25, 0);
      valIn.rotation.z = (t - sc.start) * 0.15;
      const p0 = eoB(ramp(t, sc.start + 0.3, sc.start + 1.0));
      leader.scale.setScalar(Math.max(0.001, p0) * (1 + 0.15 * Math.sin(t * 4) * (t > tSt[0] && t < tSt[0] + 1 ? 1 : 0)));
      valLines.userData.op = 0.6 * eo3(ramp(t, sc.start + 0.7, sc.start + 1.3));
      vals.forEach((v, i) => {
        v.scale.setScalar(Math.max(0.001, eoB(ramp(t, sc.start + 0.45 + i * 0.08, sc.start + 1.0 + i * 0.08))));
        const te = tSt[1] + i * 0.22; const k = eo3(ramp(t, te, te + 0.25));
        let col = new THREE.Color(C.ink).lerp(new THREE.Color(i === 2 ? C.red : C.blue), k);
        if (i === 2) col.lerp(new THREE.Color(C.blue), eo3(ramp(t, tRes - 0.15, tRes + 0.1)));
        v.material.color.copy(col);
        // pulses: out on propose, back on vote
        const pu = vPulse[i];
        const po = ramp(t, tSt[0] + i * 0.06, tSt[0] + 0.7 + i * 0.06), pv = ramp(t, te, te + 0.6);
        if (po > 0 && po < 1) { pu.visible = true; pu.position.copy(v.position).multiplyScalar(eio(po)); pu.material.color.setHex(C.blue); pu.material.opacity = 1; }
        else if (pv > 0 && pv < 1) { pu.visible = true; pu.position.copy(v.position).multiplyScalar(1 - eio(pv)); pu.material.color.setHex(i === 2 ? C.red : C.blue); pu.material.opacity = 1; }
        else pu.visible = false;
        pu.userData.op = pu.visible ? 1 : 0;
      });
    }
  }
  // stream
  {
    fade(stream, E.why.e);
    if (stream.visible) stream.children.forEach(m => {
      const d = m.userData; m.position.set(((d.x0 + t * d.sp) % 40) - 20, d.y, d.z); m.scale.setScalar(d.s); m.rotation.set(t * d.rv, t * d.rv * 0.7, 0);
    });
  }
  // risk
  {
    const sr = S.risks; fade(riskG, E.risks.e);
    if (riskG.visible) {
      let j = 0; tRk.forEach(tr => { j += Math.exp(-Math.max(0, t - tr) * 7) * (t > tr ? 1 : 0); });
      const p = eoB(ramp(t, sr.start + 0.3, sr.start + 1.1));
      riskG.position.set(4.7 + (hash(Math.floor(t * 30), 1) - 0.5) * 0.3 * j, -0.2, 0);
      riskG.scale.setScalar(Math.max(0.001, p) * (1 + 0.12 * j));
      riskWire.rotation.set(t * 0.4, t * 0.6, 0); riskCore.rotation.set(-t * 0.5, t * 0.3, 0.2); riskWire2.rotation.set(t * 0.2, -t * 0.35, 0.5);
    }
  }
  // tunnel
  {
    const sf = S.future; fade(tunnel, E.future.e);
    if (tunnel.visible) {
      const u = t - sf.start, x = Math.max(0, t - tFuB + 0.6);
      const dist = u * 6 + 8 * (x < 1.2 ? x * x / 2.4 : x - 0.6);
      TUN.forEach((m, i) => {
        const z = ((i * 2.2 + dist) % (TUN.length * 2.2)) - 44;
        m.position.set(0, -0.2, z); m.rotation.set(0, 0, i * 0.26 + u * 0.15 * (i % 2 ? 1 : -1));
        m.userData.op = ramp(z, -44, -30) * (1 - ramp(z, -2, 7)) * 0.75;
      });
    }
  }
}

window.seek = t => {
  update(t);
  // re-apply fades after per-object opacity tweaks so every frame is independent of the previous one
  fade(models, E_last.problem); fade(valG, E_last.consensus); fade(tunnel, E_last.future);
  renderer.render(scene, camera);
};
await document.fonts.ready;
// warm up shaders
[0.5, 1.5, 3, 10, 20, 27, 34, 40, 50, 60, 70, 80, 88, 100].forEach(t => window.seek(t));
window.seek(0);
window.READY = true;

const qs = new URLSearchParams(location.search);
if (qs.has('t')) window.seek(parseFloat(qs.get('t')));
if (qs.has('play')) { const t0 = performance.now() - (parseFloat(qs.get('play')) || 0) * 1000; const loop = () => { window.seek((performance.now() - t0) / 1000 % DUR); requestAnimationFrame(loop); }; loop(); }

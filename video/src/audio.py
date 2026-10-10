"""Synthesize SFX + music bed from build/events.json and mix with the voiceover -> build/mix.wav"""
import json, os
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, "build")
SR = 48000
ev = json.load(open(os.path.join(B, "events.json")))
tl = json.load(open(os.path.join(B, "timeline.json")))
DUR = ev["duration"] + 0.5
N = int(DUR * SR)
rng = np.random.default_rng(42)
SC = {s["id"]: s for s in tl["scenes"]}

def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)
def lp(x, f, order=2): return sosfilt(butter(order, f, "lowpass", fs=SR, output="sos"), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, "highpass", fs=SR, output="sos"), x)
def tt(d): return np.arange(int(d * SR)) / SR

class Track:
    def __init__(self): self.x = np.zeros((N, 2), np.float32)
    def add(self, t, sig, gain=1.0, pan=0.0):
        if sig.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.stack([sig * l * 1.414, sig * r * 1.414], 1)
        i = int(t * SR)
        if i < 0: sig, i = sig[-i:], 0
        n = min(len(sig), N - i)
        if n > 0: self.x[i:i + n] += sig[:n] * gain

# ------------------------------------------------------------------ sfx
def key_click(space=False):
    d = 0.09 if space else 0.06
    t = tt(d)
    n = rng.standard_normal(len(t))
    trans = hp(n, 3000) * np.exp(-t * 900)
    body = bp(n, 1500 + rng.uniform(-300, 600), 5000) * np.exp(-t * (110 if space else 170))
    f0 = rng.uniform(150, 260) * (0.7 if space else 1)
    thock = np.sin(2 * np.pi * f0 * t) * np.exp(-t * 70)
    s = 0.9 * trans + 0.55 * body + (0.55 if space else 0.35) * thock
    # second, softer release click
    j = int(rng.uniform(0.018, 0.03) * SR)
    rel = np.zeros_like(s); m = min(len(s) - j, int(0.015 * SR))
    rel[j:j + m] = hp(rng.standard_normal(m), 2500) * np.exp(-np.arange(m) / SR * 600) * 0.35
    return (s + rel) * rng.uniform(0.7, 1.0)

def whoosh(d=0.75, big=False, soft=False):
    t = tt(d); n = rng.standard_normal(len(t))
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** (1.6 if not big else 1.2)
    # time-varying band: process in short blocks with sweeping band-pass
    out = np.zeros_like(n); blk = 512
    for k in range(0, len(n), blk):
        p = k / len(n); fc = 300 + (3200 if big else 2400) * np.sin(np.pi * p) ** 2
        seg = n[max(0, k - 256):k + blk]
        out[k:k + blk] = bp(seg, fc * 0.5, min(fc * 1.8, 20000))[-len(n[k:k + blk]):]
    sig = out * env * (0.6 if soft else 1.0) * (1.4 if big else 1.0)
    if big: sig += lp(rng.standard_normal(len(t)), 180) * env * 2.0
    pan = np.linspace(-0.8, 0.8, len(t))
    return np.stack([sig * np.cos((pan + 1) * np.pi / 4), sig * np.sin((pan + 1) * np.pi / 4)], 1) * 1.414

def boom(soft=False):
    d = 1.6 if not soft else 0.8; t = tt(d)
    f = 34 + 70 * np.exp(-t * 9)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (2.6 if not soft else 5))
    click = lp(rng.standard_normal(len(t)), 4000) * np.exp(-t * 60)
    noise = lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 7)
    s = np.tanh((1.4 * sub + 0.5 * click + 0.35 * noise) * 1.6)
    return s * (0.6 if soft else 1.0)

def impact(soft=True):
    t = tt(0.45)
    f = 60 + 120 * np.exp(-t * 25)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)
    s += bp(rng.standard_normal(len(t)), 800, 6000) * np.exp(-t * 45) * 0.6
    return np.tanh(s * 1.5) * (0.7 if soft else 1)

def pop():
    t = tt(0.12)
    f = 520 + 700 * (1 - np.exp(-t * 60))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)
    s += hp(rng.standard_normal(len(t)), 4000) * np.exp(-t * 400) * 0.4
    return s * 0.8

def glitch(soft=False):
    d = 0.32 if not soft else 0.2; out = np.zeros(int(d * SR)); i = 0
    while i < len(out):
        L = int(rng.uniform(0.008, 0.04) * SR); k = rng.integers(3)
        tq = np.arange(L) / SR
        if k == 0: seg = np.sign(np.sin(2 * np.pi * rng.uniform(200, 2400) * tq))
        elif k == 1: seg = np.round(rng.standard_normal(L) * 3) / 3
        else: seg = np.zeros(L) if rng.random() < 0.5 else np.sin(2 * np.pi * rng.uniform(60, 140) * tq)
        out[i:i + L] = seg[:len(out) - i] * rng.uniform(0.3, 1); i += L
    out = lp(out, 9000) * np.exp(-np.arange(len(out)) / SR * (4 if not soft else 7))
    return out * (0.45 if not soft else 0.3)

def tick():
    t = tt(0.02)
    return np.sin(2 * np.pi * 3800 * t) * np.exp(-t * 500) * 0.35

def riser(d):
    t = tt(d); p = t / d
    n = bp(rng.standard_normal(len(t)), 600, 9000) * p ** 2.2 * 0.5
    f = 180 * 2 ** (p * 2.6)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * p ** 2 * 0.25
    tone += np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * p ** 3 * 0.12
    return n + tone

sfx = Track(); keys = Track()
E = ev["events"]
for e in E["key"]: keys.add(e["t"], key_click(), 1.0, rng.uniform(-0.25, 0.25))
for e in E["space"]: keys.add(e["t"], key_click(True), 0.9, rng.uniform(-0.15, 0.15))
for e in E["whoosh"]: sfx.add(e["t"], whoosh(0.9 if e.get("big") else 0.6, bool(e.get("big")), bool(e.get("soft"))), 0.35 if e.get("soft") else 0.55)
for e in E["boom"]: sfx.add(e["t"], boom(bool(e.get("soft"))), 0.9)
for e in E["impact"]: sfx.add(e["t"], impact(), 0.6)
for e in E["pop"]: sfx.add(e["t"], pop(), 0.35, rng.uniform(-0.3, 0.3))
for e in E["glitch"]: sfx.add(e["t"], glitch(bool(e.get("soft"))), 0.8)
for e in E["tick"]: sfx.add(e["t"], tick(), 0.4, rng.uniform(-0.5, 0.5))
for e in E["riser"]: sfx.add(e["t"], riser(e["dur"]), 0.7)

# ------------------------------------------------------------------ music
BPM = 100; beat = 60 / BPM; bar = beat * 4
t_all = np.arange(N) / SR
def midi(m): return 440 * 2 ** ((m - 69) / 12)
# A minor: Am - F - C - G ; 2 bars each
prog = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [55, 60, 64]), (55, [55, 59, 62])]
seg = lambda a, b: ((t_all >= a) & (t_all < b)).astype(np.float32)
def smooth(x, sec=0.4):
    k = int(sec * SR); c = np.cumsum(np.concatenate([[0], x])); y = (c[k:] - c[:-k]) / k
    return np.concatenate([np.full(k // 2, y[0]), y, np.full(len(x) - len(y) - k // 2, y[-1])])

def saw(f, t): return 2 * ((f * t) % 1) - 1
pad = np.zeros(N); bass = np.zeros(N)
chord_len = bar * 2
for ci in range(int(DUR / chord_len) + 1):
    root, notes = prog[ci % 4]
    a = ci * chord_len; i0, i1 = int(a * SR), min(N, int((a + chord_len + 0.6) * SR))
    if i0 >= N: break
    t = t_all[i0:i1] - a
    env = np.minimum(1, t / 0.8) * np.minimum(1, np.maximum(0, (chord_len + 0.6 - t) / 0.6))
    s = np.zeros(len(t))
    for m in notes + [notes[0] + 12]:
        for det in (-0.12, 0.0, 0.11):
            s += saw(midi(m + det), t + rng.random())
    pad[i0:i1] += s * env / 12
    # bass: 8th-note pulse on root
    f = midi(root - 12)
    ph = (t % (beat / 2)) / (beat / 2)
    benv = np.exp(-ph * 5) * env
    bass[i0:i1] += (np.sin(2 * np.pi * f * t) * 0.9 + 0.25 * saw(f, t)) * benv
pad = lp(pad, 1400, 2)
bass = lp(bass, 400, 2)

kick = np.zeros(N); hat = np.zeros(N); arp = np.zeros(N)
kt = tt(0.35); kf = 45 + 90 * np.exp(-kt * 30)
ksig = np.tanh(np.sin(2 * np.pi * np.cumsum(kf) / SR) * np.exp(-kt * 9) * 1.6)
ht = tt(0.05); hsig = hp(rng.standard_normal(len(ht)), 7000) * np.exp(-ht * 120)
nb = int(DUR / beat) + 1
for b in range(nb):
    tb = b * beat; i = int(tb * SR)
    if i >= N: break
    n = min(len(ksig), N - i); kick[i:i + n] += ksig[:n]
    for h in range(4):
        j = int((tb + h * beat / 4) * SR); m = min(len(hsig), N - j)
        if m > 0: hat[j:j + m] += hsig[:m] * (0.6 if h == 2 else 0.25)
# arp in 16ths
at = tt(beat / 4)
for s16 in range(int(DUR / (beat / 4))):
    ts = s16 * beat / 4; ci = int(ts // chord_len) % 4; notes = prog[ci][1]
    m = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[1] + 24][s16 % 4]
    sig = np.sin(2 * np.pi * midi(m) * at) * np.exp(-at * 18) + 0.3 * np.sin(4 * np.pi * midi(m) * at) * np.exp(-at * 30)
    i = int(ts * SR); n = min(len(sig), N - i)
    if n > 0: arp[i:i + n] += sig[:n]

# arrangement (section gains)
s = SC
st = lambda k: s[k]["start"]
groove = smooth(seg(st("defi"), st("aichain")) + seg(st("genlayer"), st("risks")) + 0.6 * seg(st("risks"), st("future")) + seg(st("future") + 2.5, st("outro") + 6.0), 0.3)
arpg = smooth(seg(st("genlayer"), st("risks")) + seg(st("future") + 2.5, st("outro") + 6.0), 0.5)
padg = smooth(np.clip(seg(0, DUR - 1.2) * (0.7 + 0.3 * seg(st("aichain"), st("genlayer"))), 0, 1), 1.0)
music = pad * 0.55 * padg + bass * 0.5 * groove + kick * 0.55 * groove + hat * 0.12 * groove + arp * 0.10 * arpg
# sidechain pump from kick
pump = 1 - 0.35 * groove * np.exp(-((t_all % beat) / beat) * 6)
music *= pump
music = np.stack([music, music], 1).astype(np.float32)
# slight stereo width on pad/arp
music[:, 0] += (arp * 0.04 * arpg).astype(np.float32); music[:, 1] += (np.roll(arp, int(0.012 * SR)) * 0.04 * arpg).astype(np.float32)

# ------------------------------------------------------------------ voice
vo = Track()
for sc in tl["scenes"]:
    x, sr = sf.read(os.path.join(B, "vo", f"{sc['id']}.wav"), dtype="float32")
    x = resample_poly(x, SR, sr).astype(np.float32)
    x = hp(x, 80).astype(np.float32)
    vo.add(sc["voStart"], x, 1.0)
v = vo.x
v /= np.max(np.abs(v)) + 1e-9
v *= 0.85
venv = smooth(np.abs(v[:, 0]), 0.25); venv /= venv.max() + 1e-9
duck = 1 - 0.6 * np.clip(venv * 3, 0, 1)

def norm(x, peak):
    return x / (np.max(np.abs(x)) + 1e-9) * peak

music = norm(music, 0.30) * duck[:, None]
mix = v + music + norm(sfx.x, 0.55) * (1 - 0.3 * np.clip(venv * 3, 0, 1))[:, None] + norm(keys.x, 0.22)
# fade out tail
fo = int(1.2 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
sf.write(os.path.join(B, "mix.wav"), mix.astype(np.float32), SR, subtype="FLOAT")
print("mix written", mix.shape[0] / SR, "s")

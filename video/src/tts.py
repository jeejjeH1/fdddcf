"""Generate the voiceover per scene with Kokoro and write build/timeline.json."""
import json, os, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.environ.get("KOKORO_DIR", "models")
BUILD = os.path.join(ROOT, "build")
os.makedirs(os.path.join(BUILD, "vo"), exist_ok=True)

script = json.load(open(os.path.join(ROOT, "src", "script.json")))
kokoro = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))

# extra time before the first word / after the last word of each scene
LEAD = {"hook": 2.2, "aichain": 0.5}
TAIL = {"outro": 4.2, "aichain": 1.4, "risks": 0.9}

def trim(x, thr=0.008):
    idx = np.where(np.abs(x) > thr)[0]
    return x[max(idx[0] - 240, 0): idx[-1] + 2400] if len(idx) else x

t = 0.0
timeline = {"fps": 30, "scenes": []}
for sc in script["scenes"]:
    samples, sr = kokoro.create(sc["vo"], voice=script["voice"], speed=script["speed"], lang="en-us")
    samples = trim(samples.astype(np.float32))
    path = os.path.join(BUILD, "vo", f"{sc['id']}.wav")
    sf.write(path, samples, sr)
    vo_dur = len(samples) / sr
    lead = LEAD.get(sc["id"], 0.35)
    dur = lead + vo_dur + TAIL.get(sc["id"], 0.55)
    timeline["scenes"].append({"id": sc["id"], "start": round(t, 3), "dur": round(dur, 3),
                               "voStart": round(t + lead, 3), "voDur": round(vo_dur, 3), "text": sc["vo"]})
    print(f"{sc['id']:10s} start={t:7.2f} vo={vo_dur:5.2f} dur={dur:5.2f}", file=sys.stderr)
    t += dur
timeline["duration"] = round(t, 3)
timeline["sampleRate"] = sr
json.dump(timeline, open(os.path.join(BUILD, "timeline.json"), "w"), indent=1)
print(f"TOTAL {t:.2f}s", file=sys.stderr)

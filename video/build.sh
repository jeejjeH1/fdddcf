#!/usr/bin/env bash
# Full pipeline: voiceover -> frames -> sound design -> final MP4 (1920x1080, 30fps, Twitter-ready)
set -euo pipefail
cd "$(dirname "$0")"
: "${KOKORO_DIR:?set KOKORO_DIR to a folder with kokoro-v1.0.onnx and voices-v1.0.bin}"
npm install --silent
python3 src/tts.py                 # build/vo/*.wav + build/timeline.json
node src/render.mjs --workers 4    # build/video_noaudio.mp4 + build/events.json
python3 src/audio.py               # build/mix.wav (VO + typing + SFX + music)
ffmpeg -y -loglevel error -i build/video_noaudio.mp4 -i build/mix.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p -r 30 \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
  ../genlayer_defi_motion.mp4
echo "done -> genlayer_defi_motion.mp4"

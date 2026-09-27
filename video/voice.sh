#!/bin/sh
# Render narration with Kokoro (English, voice af_heart) and record each clip's length.
# Model files (~350 MB) live outside the repo in ~/.cache/tibo-video.
set -e
cd "$(dirname "$0")"
M=~/.cache/tibo-video
mkdir -p "$M"
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
	[ -f "$M/$f" ] || curl -fL -o "$M/$f" "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$f"
done
M="$M" uv run -q --with kokoro-onnx --with soundfile python - <<'EOF'
import json, os, re, soundfile
from kokoro_onnx import Kokoro

m = os.environ["M"]
kokoro = Kokoro(f"{m}/kokoro-v1.0.onnx", f"{m}/voices-v1.0.bin")
src = open("src/script.ts").read()
out = {}
for id, _, text in re.findall(r"id: '(\w+)', text: (['\"])(.+?)\2}", src):
    samples, rate = kokoro.create(text, voice="af_heart", speed=1.0, lang="en-us")
    soundfile.write(f"public/vo/{id}.wav", samples, rate)
    out[id] = round(len(samples) / rate, 3)
open("src/durations.json", "w").write(json.dumps(out, indent=1) + "\n")
print(out)
EOF

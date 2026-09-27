#!/bin/sh
# Render narration with macOS `say` (voice Linh, vi_VN) and record each clip's length.
set -e
cd "$(dirname "$0")"
node -e '
const {execFileSync} = require("child_process");
const src = require("fs").readFileSync("src/script.ts", "utf8");
const lines = [...src.matchAll(/id: \x27(\w+)\x27, text: \x27([^\x27]+)\x27/g)];
const out = {};
for (const [, id, text] of lines) {
  execFileSync("say", ["-v", "Linh", "-r", "175", "-o", `/tmp/tibo-vo-${id}.aiff`, text]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `/tmp/tibo-vo-${id}.aiff`, "-ar", "48000", `public/vo/${id}.wav`]);
  out[id] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `public/vo/${id}.wav`]).toString());
}
require("fs").writeFileSync("src/durations.json", JSON.stringify(out, null, 1) + "\n");
console.log(out);
'

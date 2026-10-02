#!/bin/sh
set -eu

cargo build --release --bin tibo
mkdir -p build
swiftc -O -parse-as-library -framework SwiftUI -framework AppKit -framework AVFoundation -framework Speech -framework SoundAnalysis -framework Carbon -framework Security app/*.swift -Xlinker -dead_strip -o build/TiboApp
strip -x build/TiboApp
rm -rf Tibo.app
mkdir -p Tibo.app/Contents/MacOS Tibo.app/Contents/Resources
cp build/TiboApp Tibo.app/Contents/MacOS/
cp target/release/tibo app/Tibo.icns Tibo.app/Contents/Resources/
# The agent runtime uses only Python's standard library; voice bridges stay optional.
cp scripts/tibo_agent.py scripts/tibo_agent_tools.py Tibo.app/Contents/Resources/
mkdir -p Tibo.app/Contents/Resources/workflows
cp workflows/*.md workflows/mac.js Tibo.app/Contents/Resources/workflows/
# Ship only the face clips the app names in code; the full Taby pack stays in app/taby for future moods.
mkdir -p Tibo.app/Contents/Resources/taby
cp app/taby/LICENSE Tibo.app/Contents/Resources/taby/
for gif in app/taby/*.gif; do
    if grep -q "\"$(basename "$gif" .gif)\"" app/TiboApp.swift; then cp "$gif" Tibo.app/Contents/Resources/taby/; fi
done
cp app/Tibo-Info.plist Tibo.app/Contents/Info.plist
# A real certificate keeps the designated requirement stable across rebuilds, so macOS remembers the
# microphone/speech grants from onboarding. Ad-hoc ("-") changes identity every build and re-prompts.
SIGN_ID="${TIBO_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development|Developer ID Application/ {print $2; exit}')}"
codesign --force --deep --sign "${SIGN_ID:--}" Tibo.app
mkdir -p dist && hdiutil create -volname Tibo -srcfolder Tibo.app -ov -format UDZO dist/Tibo.dmg
rm -rf "$HOME/Applications/Tibo.app"
cp -R Tibo.app "$HOME/Applications/"
cp target/release/tibo "$HOME/.local/bin/tibo"
mkdir -p "$HOME/.local/share/tibo/runtime/workflows"
cp scripts/tibo_agent.py scripts/tibo_agent_tools.py "$HOME/.local/share/tibo/runtime/"
cp workflows/*.md workflows/mac.js "$HOME/.local/share/tibo/runtime/workflows/"

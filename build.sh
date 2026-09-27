#!/bin/sh
set -eu

cargo build --release --bin tibo --bin tibo-bench --bin tibo-web
mkdir -p build
swiftc -O -parse-as-library -framework SwiftUI -framework AppKit -framework AVFoundation -framework Speech -framework SoundAnalysis -framework Carbon app/TiboApp.swift -o build/TiboApp
rm -rf Tibo.app
mkdir -p Tibo.app/Contents/MacOS Tibo.app/Contents/Resources
cp build/TiboApp Tibo.app/Contents/MacOS/
cp target/release/tibo target/release/tibo-bench app/Tibo.icns Tibo.app/Contents/Resources/
cp -R app/taby Tibo.app/Contents/Resources/
cp app/Tibo-Info.plist Tibo.app/Contents/Info.plist
codesign --force --deep --sign - Tibo.app
rm -rf "$HOME/Applications/Tibo.app"
cp -R Tibo.app "$HOME/Applications/"
cp target/release/tibo-web "$HOME/.local/bin/tibo-web"
cp target/release/tibo "$HOME/.local/bin/tibo"

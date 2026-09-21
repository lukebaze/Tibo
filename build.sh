#!/bin/sh
set -eu

cargo build --release
mkdir -p build
swiftc -O -parse-as-library -framework SwiftUI -framework AppKit -framework AVFoundation app/GravizApp.swift -o build/GravizApp
rm -rf Graviz.app
mkdir -p Graviz.app/Contents/MacOS Graviz.app/Contents/Resources
cp build/GravizApp Graviz.app/Contents/MacOS/
cp target/release/graviz target/release/graviz-bench app/Graviz.icns Graviz.app/Contents/Resources/
cp app/Graviz-Info.plist Graviz.app/Contents/Info.plist
codesign --force --deep --sign - Graviz.app
rm -rf "$HOME/Applications/Graviz.app"
cp -R Graviz.app "$HOME/Applications/"
codesign --verify --deep --strict "$HOME/Applications/Graviz.app"
cp target/release/graviz "$HOME/.local/bin/graviz"

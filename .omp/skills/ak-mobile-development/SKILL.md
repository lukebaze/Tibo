---
name: ak-mobile-development
description: Build mobile apps with React Native, Flutter, Swift/SwiftUI, Kotlin/Jetpack Compose. Use for iOS/Android, mobile UX, performance optimization, offline-first, app store deployment.
user-invocable: true
when_to_use: "Invoke when the target is an iOS or Android app."
category: engineering
keywords: [react-native, flutter, swift, kotlin, ios]
license: MIT
argument-hint: "[platform] [feature]"
metadata:
  author: agentkit
  version: "1.0.1"
---

# Mobile Development Skill

Production-ready mobile development with modern frameworks, best practices, and mobile-first thinking patterns.

## When to Use

- Building mobile applications (iOS, Android, or cross-platform)
- Implementing mobile-first design and UX patterns
- Optimizing for mobile constraints (battery, memory, network, small screens)
- Making native vs cross-platform technology decisions
- Implementing offline-first architecture and data sync
- Following platform-specific guidelines (iOS HIG, Material Design)
- Optimizing mobile app performance and user experience
- Implementing mobile security and authentication
- Testing mobile applications (unit, integration, E2E)
- Deploying to App Store and Google Play

## Choose the project target

Read manifests, lockfiles, platform project files and deployment settings to
identify the actual framework, SDK/toolchain and supported devices. Preserve the
existing architecture for a scoped UI fix. Compare frameworks only for an open
platform decision, using `references/mobile-frameworks.md`.

Handle network failure appropriately; offline-first storage/sync is a product
choice, not a mandatory migration. Define performance budgets from the product,
target devices, refresh rate and observed baseline. Measure real-device behavior
for release, battery, memory, hardware or performance claims; record unavailable
device coverage honestly. Keep secure storage, accessibility and failure recovery.

Before release, verify current Apple/Google submission requirements from official
sources against the selected target; old SDK deadline examples are not authority.

## Reference Navigation

**Core Technologies:**
- `mobile-frameworks.md` - React Native, Flutter, Swift, Kotlin, framework comparison matrices, when to use each
- `mobile-ios.md` - Swift 6, SwiftUI, iOS architecture patterns, HIG, App Store requirements, platform capabilities
- `mobile-android.md` - Kotlin, Jetpack Compose, Material Design 3, Play Store, Android-specific features

**Best Practices & Development Mindset:**
- `mobile-best-practices.md` - Mobile-first design, performance optimization, offline-first architecture, security, testing, accessibility, deployment, analytics
- `mobile-debugging.md` - Debugging tools, performance profiling, crash analysis, network debugging, platform-specific debugging
- `mobile-mindset.md` - Thinking patterns, decision frameworks, platform-specific thinking, common pitfalls, debugging strategies

## Implementation and release checks

Load `references/implementation-checklist.md` for the selected feature or release.
Budgets there are examples, not automatic acceptance thresholds.

## Resources

**Official Documentation:**
- React Native: https://reactnative.dev/
- Flutter: https://flutter.dev/
- iOS HIG: https://developer.apple.com/design/human-interface-guidelines/
- Material Design: https://m3.material.io/
- OWASP Mobile: https://owasp.org/www-project-mobile-top-10/

**Tools & Testing:**
- Detox E2E: https://wix.github.io/Detox/
- Appium: https://appium.io/
- Fastlane: https://fastlane.tools/
- Firebase: https://firebase.google.com/

**Community:**
- React Native Directory: https://reactnative.directory/
- Pub.dev (Flutter packages): https://pub.dev/
- Awesome React Native: https://github.com/jondot/awesome-react-native
- Awesome Flutter: https://github.com/Solido/awesome-flutter

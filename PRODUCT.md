# Product

<!-- impeccable:product-schema 1 -->

## Platform

macOS native (SwiftUI + AppKit, macOS 13+, Liquid Glass APIs on macOS 26). Not iOS/Android; no web surface.

## Users

Vietnamese-speaking Mac users in the middle of other work. They glance up at the menu bar, ask, drop a file or approve an action in 5–30 seconds, then go back. Keyboard first; voice is optional and the app is fully usable with the microphone off.

## Product Purpose

Tibo is a real agent that lives in the Mac notch: it calls an OpenAI-compatible model, uses tools (files in a workspace, shell, web, Mac apps, MCP), keeps long-term memory and asks before anything with consequences. Success is getting a task done from the notch without opening a second app or window.

## Positioning

The agent is the notch itself, not a chat window docked near it. Consequential actions wait for an explicit approval in the same place the user asked.

## Operating Context

- Opened by clicking the pill, the global hotkey (default ⌃⌥Space), dragging a file over it, or by Tibo starting work; hover alone never opens it.
- Runs beside whatever the user is doing; the rest of the menu bar must stay clickable.
- MacBooks with a hardware notch and external displays without one.

## Capabilities and Constraints

- Agent runtime is a Python stdlib process (`scripts/tibo_agent.py`) speaking JSONL to the app; the UI renders its events.
- Tools: read/list/search/write files in the workspace, shell, web fetch/search, session search, memory, skills, Mac read/write, MCP.
- Shell, file writes, Mac writes and MCP ask for approval; a small set of read-only commands does not. Denied or expired approvals never run.
- Attachments: up to 10 items, 30,000 characters each, 60,000 per turn; dropping never sends.
- API keys live in the macOS Keychain, never in `profile.json` or history.

## Brand Commitments

- Brandkit (`.github/tibo-brandkit.webp`): ink `#0B0C14`, amber `#FFB35C`, ember `#FF6A3D`, paper `#F7F5F0`; tagline "Ở ngay đây."; app icon `app/icon.svg`.
- Taby's face (animated GIFs in `app/taby/`) is the character; artwork used under `app/taby/LICENSE`.
- Voice: Vietnamese, short, active, no exclamation marks in system copy; say what happened and what the user can do.

## Evidence on Hand

README, `docs/agent-architecture.md`, `docs/computer-use.md`, brandkit, icon, Taby clip pack. No user research, testimonials or metrics; do not invent them.

## Product Principles

1. Agent truth: a step never shows success without a result; denial and cancel never look like success.
2. Consent before consequence: approvals are explicit, fail closed (Esc denies), and never widen trust silently.
3. The user hands things over deliberately: dropping or attaching never sends; only user-handed items are read.
4. Collapsing never cancels; only Stop stops.
5. Full keyboard and VoiceOver paths for every action.

## Accessibility & Inclusion

Keyboard-complete, VoiceOver labels on every icon control, 24 pt minimum hit targets (28 pt used), Reduce Motion removes non-essential motion, WCAG AA contrast for text.

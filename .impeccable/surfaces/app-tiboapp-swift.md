---
version: 1
slug: "app-tiboapp-swift"
primary_target: "app/TiboApp.swift"
related_targets: ["app/AgentSpaceViews.swift","app/Onboarding.swift"]
---

# Surface: Tibo notch (+ onboarding/settings windows)

Mode: Operate. Scene: a Vietnamese Mac user mid-task glances at the notch, asks, drops a file or approves an action in 5–30 s. Keyboard first, voice optional. Success: the job is done from the notch; consequential actions were consented to, never widened silently.

Scope: collapsed pill, expanded island (header, timeline, tool steps, approval, composer, history, drop, error), onboarding and settings windows (brand alignment and copy only; they stay standard macOS Forms).

## Direction contract

THESIS: The notch itself grows. Expanded Tibo stays the hardware's black, a Taby Island, instead of switching material to glass; the category default it refuses is a chat window (grey bubbles in a translucent panel) parked under the menu bar.

OWN-WORLD: Pure black island continuous with the camera housing; brandkit paper #F7F5F0 text, amber #FFB35C for the one action that matters, ember #FF6A3D only inside the working light; SF Pro body, SF Rounded for Taby's voice, SF Mono only for commands and paths; white-alpha layers, no borders on rows, 10/14 radii inside a 24 pt island.

STORY: Taby's face and one status sentence say what is happening; steps read as human Vietnamese; when Tibo needs consent, the island asks in place of the composer and states exactly what will run and what will be remembered.

FIRST VIEWPORT: Menu-bar band: Taby's face 48×26 pt directly on black at the left, status sentence beside it, icons right of the camera. Body: conversation with soft-faded scroll edges; composer pill at the bottom with an amber send disc. Approval replaces the composer.

FORM: Taby Island, pinned by the user in this session (no concept-seed roll; seed key: none). Signature move: the ember horizon, sunset light sweeping along the island's lower edge while Tibo works or listens, static under Reduce Motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Approval trust scope comes from the runtime (`remember` prefix on the approval event); destructive verbs and chained commands are never remembered.

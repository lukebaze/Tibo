---
name: Tibo Taby Island
description: A black notch island for short, focused Vietnamese agent work.
colors:
  island: "#000000"
  paper: "#F7F5F0"
  secondary: "rgba(247,245,240,0.62)"
  amber: "#FFB35C"
  ember: "#FF6A3D"
  ink: "#0B0C14"
  surface: "rgba(247,245,240,0.07)"
  raised: "rgba(247,245,240,0.12)"
  hairline: "rgba(247,245,240,0.14)"
  success: "#30D158"
  danger: "#FF453A"
typography:
  voice:
    fontFamily: "SF Pro Rounded, system-ui"
    fontSize: "13px"
    fontWeight: 600
  title:
    fontFamily: "SF Pro Rounded, system-ui"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "SF Pro, system-ui"
    fontSize: "13px"
  caption:
    fontFamily: "SF Pro, system-ui"
    fontSize: "12px"
  label:
    fontFamily: "SF Pro, system-ui"
    fontSize: "12px"
    fontWeight: 600
  mono:
    fontFamily: "SF Mono, ui-monospace"
    fontSize: "11.5px"
  approval:
    fontFamily: "SF Mono, ui-monospace"
    fontSize: "12px"
rounded:
  island-expanded: "24px"
  island-collapsed: "10px"
  card: "14px"
  row: "10px"
  details: "8px"
  composer: "16px"
  control: "14px"
spacing:
  island-width: "640px"
  empty-height: "92px"
  conversation-height: "200px"
  approval-extra: "36px"
  wing: "40px"
  control: "28px"
components:
  send:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "28px"
  allow:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  composer:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.composer}"
    padding: "2px 10px"
  drop-target:
    backgroundColor: "{colors.island}"
    borderColor: "{colors.amber}"
    rounded: "18px"
  approval-well:
    backgroundColor: "{colors.island}"
    typography: "{typography.approval}"
    rounded: "{rounded.row}"
---

# Design System: Tibo Taby Island

## Overview

**Creative North Star: "Taby Island"**

Tibo is a small black island cut into the menu bar: the hardware notch remains black when the island opens, and Taby's face supplies the personality. It is a short, dense work surface for asking, attaching, watching an agent act, and approving one consequential action—often in Vietnamese.

The island grows sideways rather than becoming a second window. Paper, amber, and restrained tonal wells keep attention on the one action that matters. Tokens live in `TiboStyle`; change them there, not inline.

**Key Characteristics:**
- Black hardware-matched island, with 640 pt expanded width.
- Amber is scarce and actionable; ember is not a state color.
- Rounded, compact, keyboard-first work surface with accessible 28 pt controls.

## Colors

A dark island carries warm paper text and a single amber action accent. Success and danger are system signals, always paired with icon shape and text.

### Primary
- **Taby Amber** (#FFB35C): send, allow, focused composer border, drop target, and attachment badge. It is not status text and does not style the history toggle.

### Secondary
- **Working Ember** (#FF6A3D): only the working light's sweep and the onboarding/app-icon bezel gradient; never a state color.

### Neutral
- **Island Black** (#000000): collapsed and expanded island background, matched to the camera housing.
- **Paper** (#F7F5F0): primary text and icons.
- **Paper Secondary** (rgba(247,245,240,0.62)): secondary text and quiet status detail.
- **Ink** (#0B0C14): text and symbols on amber; the high-contrast alternative to white on amber.
- **Surface** (rgba(247,245,240,0.07)): tool rows, composer, timeline wells.
- **Raised** (rgba(247,245,240,0.12)): user messages, chips, secondary buttons.
- **Hairline** (rgba(247,245,240,0.14)): dividers and borders.
- **Success** (#30D158) / **Danger** (#FF453A): completed and failed tool states; pair each with icon and text.

### Named Rules
**The One Action Rule.** Amber marks send, allow, focus, drop, and attachment presence—not decoration, status copy, or history.

**The Ember Rule.** Ember belongs to the moving working light and the app-icon/onboarding bezel only. It never communicates success, failure, or other state.

## Typography

**Display Font:** none; this is a compact utility surface.
**Body Font:** SF Pro / system UI.
**Label/Mono Font:** SF Pro for labels; SF Mono for paths, commands, raw output, and approval content.

**Character:** Rounded semibold voice and title text make Taby feel present without turning the island into a mascot panel. Body copy stays compact; monospace reserves a clear boundary for machine text.

### Hierarchy
- **Voice** (semibold rounded, 13px): status line and questions the island asks.
- **Title** (semibold rounded, 15px): prominent island headings.
- **Body** (regular, 13px): messages and composer text.
- **Caption** (regular, 12px): tool targets and quiet detail.
- **Label** (semibold, 12px): controls and tool-state labels.
- **Mono** (regular, 11.5px): commands, paths, raw output.
- **Approval well** (regular mono, 12px): the pending action and preview.

### Named Rules
**The Machine Boundary Rule.** Human wording leads; raw command/path detail uses mono and stays one interaction away except in approval.

## Layout

The expanded island is 640 pt wide. With nothing to show it is 92 pt tall; a conversation is 200 pt, and an approval adds 36 pt. The collapsed non-notch pill is `2 * wing + 64` (144 pt), with each wing 40 pt; when hardware notch width is known, the pill is the notch plus two wings. The face and live status share the menu-bar band around the camera gap.

Opening is click, the configured hotkey (⌃⌥Space), file drag, or Tibo beginning work; hover alone never opens. The menu bar remains clickable beside the pill. Esc, the chevron, or loss of focus tucks it away. Keyboard controls include Return to send, ⌘. to stop, Esc to deny, and ⌘↩ to allow.

## Elevation & Depth

This is tonal layering, not glass: the island is flat black, with 7% surface wells, 12% raised wells, and 14% hairlines. The working light is a 10 pt blurred, 70% opacity EmberHorizon glow plus a 1.5 pt crisp sweep; it rises from the bottom edge and fades at the sides rather than framing the island.

### Named Rules
**The Black Island Rule.** Never replace the island background with material or adaptive glass; the hardware black is the visual anchor.

## Shapes

The island uses continuous rounded geometry: 24 pt expanded, 10 pt collapsed, 14 pt cards, 10 pt rows, 8 pt details, and 16 pt composer. Controls use 28 pt hit targets and 14 pt circular-control radii. Content clips to the island; timeline edges soften with 12 pt black-to-clear fades at top and bottom.

## Components

### Buttons
- **Shape:** 28 pt controls; continuous rounded geometry.
- **Primary:** Amber fill with ink text; send and allow are the primary actions.
- **Hover / Focus:** focused composer receives amber at 60% opacity as its border; state transitions are 120–150 ms ease-out.
- **Secondary / Ghost:** tonal raised or surface treatment; history remains neutral and never amber.

### Chips
- **Style:** surface capsule with paper text and a secondary icon; empty state offers `Đọc màn hình` and up to two configured quick prompts.
- **State:** action chips send their prompt; attachment badges use amber to show presence.

### Cards / Containers
- **Corner Style:** cards 14 pt; rows 10 pt; details 8 pt.
- **Background:** black island with surface wells and raised user/chip wells.
- **Shadow Strategy:** no shadow vocabulary; depth is tonal.
- **Border:** hairline, or amber focus/drop treatment where state requires it.
- **Internal Padding:** timeline horizontal 16 pt, top 12 pt; tool stack header 12 × 8 pt; tool rows 8 × 4 pt; errors 12 × 9 pt; approval card 12 pt.

### Inputs / Fields
- **Style:** composer surface in a 16 pt continuous rounded well, 2 pt internal padding, 10 pt outer horizontal padding.
- **Focus:** amber border at 60% opacity.
- **Error / Disabled:** danger rows use danger at 16% opacity; unavailable send uses surface and secondary text.

### Navigation
- **Style:** the header owns the face, the status line, and icon controls for stopping speech, history, new session and collapse. History stays neutral when open.

### Timeline
Messages and tool steps remain in chronological order. Assistant text renders as blocks (paragraphs, lists, headings, fenced code) inside a timeline whose top and bottom fade into the island; consecutive tool steps collapse into a tool stack, while a single step is a human-readable tool row. Errors become Vietnamese sentences where the wording is known, and offer **Mở Cài đặt** when the message names an API key, endpoint, model or HTTP 401/403/404.

### Approval Card
Approval replaces the composer. It shows the human-readable action and the full command/path and preview in the 12 pt mono approval well on island black; long commands scroll inside the well (about four lines) and are never elided. Từ chối / Cho phép carry visible key hints: Esc denies, ⌘↩ allows. “Lần sau tự chạy …” appears only when the runtime supplies a remember scope; it starts off and resets for every approval. Consent never comes from a stray click: while an approval waits, the island turns off click-through, so the first click on an unfocused island only focuses it, and Allow ignores input for its first 0.5 s (it sits where the send button was).

### Header & Face
The header face zooms to 1.1 in a 58 pt box, trimming the clip's black margin so the face fills the menu-bar band without cutting its props. Moods: idle, thinking, talking, asking, sleeping, surprised while dragging, failed (`disappointed`) on failure, and happy for about 2 s after a completed run or a drop.

### Working Light
EmberHorizon sweeps amber and ember along the lower edge while working/listening: its gradient stops use transparent ember at 0 and 1, ember at `phase - 0.3` and `phase + 0.3`, amber at `phase`; the glow is 10 pt blurred at 0.7 opacity with a 1.5 pt crisp stroke. Reduce Motion removes animation and leaves the light static.

### Setup Windows
Setup uses the system Form in a 720 × 560 pt window (minimum 640 × 560); other controls stay system-native. `tiboProminent` is ink-on-amber; onboarding progress is amber. The welcome face uses the ink screen inside the app icon's amber→ember bezel (24 pt inner and 34 pt bezel radii); ember is intentionally limited to this bezel and the working light.

## Do's and Don'ts

### Do:
- **Do** keep all palette, type, radius, and size tokens in `TiboStyle`.
- **Do** use amber only for send, allow, focus, drop, and attachment presence.
- **Do** keep machine detail monospace and human wording short, active, and Vietnamese-first.
- **Do** respect Reduce Motion: remove spring/ease animation and press scale; keep the state understandable.
- **Do** delay Allow arming by 0.5 s so approval cannot be accepted accidentally.

### Don't:
- **Don't** use material, glass, or a colorful ambient background inside the island.
- **Don't** use ember as success, failure, listening, or status text.
- **Don't** color status text or the history toggle amber.
- **Don't** auto-send dropped files; dropping focuses the composer and requires explicit Return.
- **Don't** repeat the live header status in the timeline.
- **Don't** use exclamation marks in system copy.

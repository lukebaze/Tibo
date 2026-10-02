# UX/AX review: Tibo notch agent — 2026-10-01

## Verdict

Before this round the notch was a generic chat form. You could not hand it a file. Tool steps were listed after all the messages, approvals showed raw JSON, and on a notched Mac the collapsed state sat entirely under the camera housing, so nothing was visible. The redesign keeps the notch concept and adds drag/drop and an attach button. It also shows tool steps in order with human wording, adds an approval card with keyboard shortcuts, and uses the collapsed wings to show the face and status. Every Must item is implemented and verified except two: a real drag gesture, and the wing layout on the notched display. Both are listed under unresolved questions.

## Scope and environment

- Mode: implementation (`--auto` equivalent), plus a `redesign-existing-projects` pass on the same surface.
- Surface: native SwiftUI notch (`app/TiboApp.swift` `ContentView`, `app/AgentSpaceViews.swift`, `app/AgentAttachments.swift`, `app/AgentController.swift`), runtime `scripts/tibo_agent.py` (`attachment_block`).
- Run: isolated bundle `build/TiboUX.app`, isolated data dir under `$TMPDIR`, and a local mock OpenAI-compatible provider on 127.0.0.1:8791. Not `build.sh`, so the installed app is untouched.
- Not applicable: `check-discovery-surfaces.mjs` (no public website for this surface; `web/` belongs to the legacy harness pending deletion), the 1440/768/375 web viewports, and `render-check.mjs`. Instead the review used window-only captures of the real panel on the display macOS treated as main: the external 2560×1440 at 1x, which has no hardware notch.
- A runtime was being edited in parallel (pane tibo3). Its cancel bug is reported there and not fixed here.

## Baseline evidence (round 0)

| State | File | Finding |
|---|---|---|
| Collapsed, notched display | `round-0/notch-collapsed.png` | Pure black. The face is drawn under the camera housing, so the collapsed state shows nothing. |
| Expanded | `round-0/notch-expanded-failed.png` | Face, red error caption, a "Phiên" menu, an empty area, then text field + Gửi + three equal-weight buttons (mic, read screen, stop voice). No empty state, no attach. |

The runtime at baseline failed to import (`memory_snapshot`) because the parallel edit was in progress; the UI judgement does not depend on it.

## Scores (0–3)

| Area | Before | After | Evidence |
|---|---|---|---|
| First impression | 1 | 2 | `round-1/notch-expanded-empty.png`: one question, one sentence, three real actions |
| Brand recall | 1 | 2 | Face in the header and collapsed wing; Taby orange only on action/focus/approval |
| Content punch | 1 | 2 | Tool steps read "Xem thư mục · thư mục làm việc"; denial reads "Không chạy: bạn đã từ chối…" |
| Clarity and hierarchy | 1 | 2 | One primary action (send/stop); utilities moved into + and header icons |
| Storytelling (agent trace) | 0 | 2 | `round-1/notch-restored-session.png`: message → tool step → result in order, also after restart |
| Knowledge and trust | 1 | 2 | Approval card shows the exact command; failed steps are red with text, not colour alone |
| Motion | 2 | 2 | Expand spring kept; 120–150 ms state feedback; Reduce Motion removes all of it |
| Responsive (screens) | 1 | 2* | 380-wide expanded layout fits the 440 panel; *notched wing layout not captured (see questions) |
| Accessibility | 1 | 2 | AX tree: every control labelled, approval is a labelled group, user rows read "Bạn: …" |
| Performance feel | 2 | 2 | Attachment extraction runs off the main thread; Stop during extraction never sends |

## Proposals

### P1: Drag/drop and attach into the notch (Must). Done, gesture unverified
- Evidence: there was no drop handler before. `safe_path` blocks files outside the workspace.
- Change: `.dropDestination(for: URL.self)` on the notch. The collapsed notch opens when a drag hovers it (drag pasteboard `changeCount` + mouse down, because the collapsed panel ignores mouse events). There is a + → attach panel (the non-drag alternative, WCAG 2.5.7). Chips with labelled remove buttons. Drop never sends.
- Content: Swift extracts text from text/PDF/Word/RTF/ODT, OCR from images, and folder listings. Python `attachment_block` fences the content and sends images as vision parts. Limits: 10 items, 30k characters per file, 60k per turn.
- Acceptance: payload → runtime → provider E2E passed (md, pdf, png OCR + JPEG, folder, link reached the model). Attach panel → chips → send passed via AX. A real drag gesture is **not** verified: synthetic drags never started an `NSDraggingSession`.

### P2: Timeline in real order with human tool wording (Must). Done
- Change: messages and tool steps are merged by time. A tool step splits the streaming message. Restored sessions rebuild tool steps from history instead of showing raw `tool` messages. Runtime `{"error":…}` results are shown as sentences.
- Acceptance: `round-1/notch-tool-step.png`, `round-1/notch-restored-session.png`; the AX tree reads "Chạy lệnh mkdir -p … , thất bại / Không chạy: bạn đã từ chối…".

### P3: Approval card (Must). Done
- Change: names the action, shows the full command/path (and a preview of written content), Esc denies, ⌘↩ allows, announced to VoiceOver.
- Acceptance: deny left `ws/file.txt` in place; allow moved it to `ws/xong/file.txt`. Captures: `round-1/notch-approval.png`, `round-1/notch-approved-result.png`.

### P4: Collapsed wings (Must). Done, notched capture missing
- Change: the pill on a notched display is notch width + 2×36 pt. Left wing holds the face, right wing holds status (spinner, approval hand, error, attachment count, mic). Non-notched displays keep the 250-pt pill with the same layout.
- Acceptance: `round-1/notch-collapsed-idle.png` (non-notched). The notched capture is still pending.

### P5: Read screen through the attachment path (Should). Done
- Evidence: the old flow put up to 6,000 characters of OCR into the visible user message.
- Change: the screen capture becomes an image attachment named "Màn hình.jpg". The question stays the visible message, and the frontmost app name goes in as context.

### P6: Attach panel invisible and blocking (Must, found in verification). Fixed
- Evidence: `NSOpenPanel.runModal()` from the inactive menu-bar app opened an off-screen panel, blocking the app until it was killed.
- Change: `hidesOnDeactivate = false`, floating level, macOS 14 `NSApp.activate()`, and non-modal `begin`.
- Acceptance: the panel window is on screen (layer 3) and the selected file becomes a chip.

### P7: States and craft from the redesign pass (Should). Done
- Hover lighten, press scale (off under Reduce Motion), and one button style for all controls. Black text on orange (white on orange is 2.1:1). Rounded title. Escaped slashes removed from tool details. List-path "." shows as "thư mục làm việc". The system focus ring is suppressed only on the composer field, which draws its own accent border.
- Rejected from the generic web skill: pure-black replacement (the notch must match the hardware), web font swap (SF is the platform face), grain or texture (OS surface), and desaturating Taby orange (brand colour).

## DONE contract (native adaptation)

1. Must/Should proposals meet their checks: **yes, except** the P1 gesture and the P4 notched capture (unresolved questions).
2. Discovery scan: **not applicable** (no website surface).
3. Window-only captures of changed states show no clipping or overlap: **yes** on the 1x external display (`round-1/`).
4. No rubric area regressed; every area is ≥ 2: **yes** (Responsive carries the notched-capture caveat).
5. Keyboard and Reduce Motion: Return/Esc/⌘↩/⌘. are wired, and AX-driven send/deny/allow/stop passed. Reduce Motion was checked in code only.
6. Build/tests: Swift typecheck clean; `python3 -m unittest scripts/test_tibo_agent.py` 21 tests OK; the bundle builds.
7. `DESIGN.md`, `REVIEW.md` and an `AGENTS.md` pointer were added; README and the plan contract were updated.
8. Processes: the isolated test app and the mock provider are left running only for the manual drag check; stop them afterwards.

## Round log

| Round | Proposals done | Checks passing | Regressions fixed | Notes |
|---|---|---|---|---|
| 1 | P1–P7 | E2E payload, AX flows, restore, approval allow/deny | Invisible blocking attach panel; AX role of user rows; double focus ring check (single accent ring confirmed) | Runtime cancel returns `failed` with an AttributeError; reported to the runtime owner |

## Unresolved questions

None open.

Resolved in round 2:
- Cancel: the runtime ends a cancelled run with `done(cancelled)` only; AX-driven Stop shows "Đã dừng" (`round-2/notch-cancelled.png`).
- Real drag gesture, tested by the user: the drop worked, but Return did nothing because Finder kept the keyboard after the drop. The notch now activates Tibo after a drop, resets composer focus, and Send is the default action. The user's retest returned the attachment answer ("Mình đã nhận ke-hoach.md. Dòng đầu: # Kế hoạch tuần 40").
- Notched display: the panel followed `NSScreen.main`, which for Tibo is the screen of its own key window, so once focused it stuck to one display. While collapsed it now follows the pointer's screen. Capture: `round-2/notch-collapsed-notched.png` (face in the left wing, outside the camera housing).

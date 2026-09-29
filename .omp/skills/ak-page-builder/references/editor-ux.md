# Responsive, mobile and touch editor

Read this when building or reviewing the human editing surface. Both the editor
shell and the produced pages need responsive behavior; a narrow preview iframe
does not prove that the editor itself works on a phone.

## Editing experience

Provide block search, a page outline, typed property controls, valid drop targets,
undo/redo, autosave status, preview and publication state. Bind all changes to the
same operations used by agents. Preserve focus, selection and stable node IDs
when properties change. Show empty/error/loading states for dynamic content.

Reuse project spacing, typography, semantic colors, breakpoints and components.
Use desktop panels where space permits; use drawers, sheets or a focused editing
mode on narrow screens. Keep the canvas, selected block and primary actions
reachable without requiring horizontal scrolling of the entire editor shell.

## Mobile and touch behavior

- Support phone/tablet widths, portrait/landscape, safe-area insets and browser
  chrome changes. Reflow controls and keep draft status visible.
- Make tap targets and spacing usable under the project's accessibility standard;
  approximately 44 CSS pixels is a useful starting design target, not proof of
  conformance. Avoid hover-only controls and precision-only drop zones.
- Use pointer-aware drag handles and deliberate activation to distinguish drag
  from vertical scrolling. Keep ordinary page scrolling and pinch zoom available;
  do not disable touch gestures across the whole canvas.
- Handle nested scrolling, edge auto-scroll, pointer cancellation and dragging
  outside valid slots. Cancelled gestures leave content unchanged.
- Offer move-before/after, move-to-slot and outline controls as alternatives to
  dragging. Support keyboard operation and accessible names/focus feedback.
- Keep inputs, validation messages and save controls visible when the virtual
  keyboard opens. Preserve edits across orientation changes and sheet dismissal.
- Report saving/saved/failed states. Retain recoverable local draft changes after
  a network interruption, scope local persistence to the account/project, and
  reconcile revisions before retrying after reconnect. Clear sensitive cached
  drafts on logout according to the host's policy.

## Responsive page model

Implement [widget sizing](widget-sizing.md) with small/medium/large controls and
resize handles for supported blocks. Preview the snapped size and affected
layout while dragging; commit one revision-aware operation on completion, and
restore the original layout on cancellation. Do not persist every pointer move.
Separate move and resize handles, provide generous touch hit areas, and expose
the same sizes through a labeled picker and keyboard controls. Announce the
selected/effective size and invalid-fit feedback accessibly. Preserve focus and
editing state across presentation changes.

Prefer layout constraints, tokens and existing responsive variants over absolute
coordinates. Store only supported breakpoint overrides. Ensure visual reordering
does not create an incoherent reading/tab order. Allow content to grow: long
headlines, translated text, RTL, lists, empty media and large text should reflow.
Preview uses the production renderer with editing affordances isolated from it.

Load editor-only code separately from published pages. Virtualize large outlines
when measurements justify it; keep selected controls accessible. Avoid mounting
every heavy block merely to show a catalog preview.

## Acceptance checks

On representative phone, tablet and desktop viewports, complete: find a block,
insert it, edit text, change a variant, resize through supported widget sizes,
move into a nested layout, undo, reload a
saved draft, preview and observe the publication result. Repeat core movements
with touch and keyboard. Exercise virtual-keyboard overlap, orientation change,
zoom, long localized content, cancelled drag/resize and offline/reconnect conflict.
Test container-based size resolution on desktop and mobile, including collisions,
locked siblings and unsupported sizes. Confirm shrinking then expanding retains
content and that the size picker works without a precise dragging gesture.

Use available browser automation and accessibility tooling, plus a real touch
device when available. State whether evidence is viewport-only, touch-emulated
or real-device; do not describe desktop mouse checks as touch validation.

# UI review checklist (notch)

Every UI change ships with window-only screenshots of the changed states (`screencapture -l <window id>`; never a screen region, which captures other apps' private content).

- States: collapsed (hardware notch and non-notch screen), expanded empty, streaming, tool step running/done/failed, approval (with and without a remember scope, long command), drop target, attachment tray, error, restored session.
- Contrast: the island is black in light and dark mode alike; text uses `TiboStyle.text`/`secondary`, amber carries ink text, and amber appears only on the action (send, allow, focus, drop).
- Keyboard: ⌃⌥Space opens and focuses; Return sends; ⌘. stops; Esc denies an approval, otherwise collapses; ⌘↩ allows (ignored for the card's first half second).
- Consent clicks: with an approval open and Tibo not focused (you clicked back into another app), one click on Cho phép only focuses the island and sends nothing; the second click allows.
- VoiceOver: every icon control has a label; tool rows read title, target and status; approvals and drops are announced.
- Motion: Reduce Motion removes expand spring, press scale and fades, and holds the ember horizon still.
- Agent truth: a tool step never shows success without a result; denial/cancel never look like success; collapsing never cancels.
- Attachments: dropping never sends; only user-handed items are read; limits (10 items, 30k chars each, 60k per turn) hold.

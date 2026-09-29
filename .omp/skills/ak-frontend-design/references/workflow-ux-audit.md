# Live product UX audit workflow

Audit a running product (dev, staging or production) by using it the way a real user
would, then deliver an evidence-backed report of what feels broken, cramped, confusing
or unfinished, with concrete fixes. Judge every finding against
`ux-polish-standards.md`.

## 1. Set up access

- Ask which environment to audit and its URL. Prefer dev or staging; audit production
  read-only unless the user explicitly allows mutations there.
- Drive the browser through the user's real Chrome session (Chrome MCP, or
  `ak:chrome-profile` when installed and a specific profile is needed) so existing
  logins apply. Fall back to `ak:agent-browser` when the audit needs no account state.
- If a page needs authentication, ask the user to sign in themselves in that browser
  and wait. Never type passwords, tokens or payment details, and never create accounts.
- Agree on destructive boundaries before clicking: do not submit real payments, send
  messages, delete data or change account settings. Use test records, or open the
  confirmation dialog and cancel it.
- Create an evidence folder, for example `plans/reports/ux-audit-<date>/screenshots/`,
  and name every capture `<viewport>-<page>-<state>.png`.

## 2. Map the product

Build an inventory before judging anything: every route from the navigation, footer,
account menu and settings; every modal, drawer, panel, popover and toast; and the main
user journeys (onboarding, the core daily task, search, create/edit/delete, settings,
billing, error recovery). Record the list in the report so coverage is visible.

## 3. Walk every page at every viewport

Run the full walk at three viewports: desktop (1440×900), tablet (768×1024) and
mobile (375×812). For each page:

1. Capture the first paint, then the loaded state.
2. Hover, focus (keyboard Tab) and click every interactive element; note missing or
   inconsistent hover, active, focus-visible, disabled and loading feedback.
3. Open every modal, panel, dropdown and menu; test Escape, outside-click, focus trap
   and scroll lock; check that it fits the viewport.
4. Exercise forms with empty, invalid, very long and valid input; watch validation
   timing, message wording and what survives a failed submit.
5. Reload, go back and forward, and open a deep link in a new tab; note any lost
   filters, tabs, pagination, scroll position or draft input.
6. Try empty, loading, error, very large and very long-text data states where reachable.
7. Read the console and failed network requests for errors that surface as UI bugs.
8. Screenshot every defect and every state worth comparing.

For pages reachable without sign-in, also run `../scripts/render-check.mjs <url>` to get
per-viewport overflow, contrast, clipping and touch-target findings as a baseline.

Then replay each main journey end to end, counting clicks, page changes, waits and the
moments where you had to stop and think about what to do next.

## 4. Classify findings

Record each finding as:

| Field | Content |
|---|---|
| ID and title | Short, specific (e.g. "Project filter resets after reload") |
| Where | Page/route, component, viewports affected |
| Evidence | Screenshot path(s), steps to reproduce, console/network excerpt if relevant |
| Category | Logic bug · Layout/spacing · Interaction feedback · Navigation/flow · Information architecture · Copy/guidance · Accessibility · Performance perception · Visual polish |
| Severity | Blocker (task impossible or data risk) · Major (task slowed or confusing) · Minor (friction) · Polish (lacks care/delight) |
| Why it matters | The user impact, tied to the journey |
| Fix | Concrete change: component, pattern, token, copy or behavior; include creative improvements, not only repairs |

Separate observed facts from judgment. Do not guess at causes you have not verified;
mark them as hypotheses.

## 5. Report

Write the report to `plans/reports/ux-audit-<date>-<product>.md` (or the project's
report location). Base the fixes on `product-ui-patterns.md` for app surfaces and
`taste-exemplars.md` for visual polish. Include:

1. Summary: overall impression, top five issues and the fastest high-impact wins.
2. Coverage: environment, viewports, pages, modals and journeys covered, plus anything
   not reached and why.
3. Journey analysis: each main journey with friction points and a proposed smoother flow.
4. Findings grouped by severity, then category, with embedded screenshots.
5. Cross-cutting recommendations: design tokens, spacing scale, shared components
   (searchable select, command palette, toast, empty state), motion system.
6. Prioritized fix plan: quick wins, then structural changes.

When the user asks for fixes, implement them with the project's stack and components,
then re-verify each fixed finding at all three viewports with new screenshots.

## 6. Offer to record the standard

After delivering the report, ask the user whether to record the design philosophy in
the project's agent instructions (`CLAUDE.md`, and `AGENTS.md` when present or used by
their runtimes). Only on approval, add a short section that summarizes the principles
from `ux-polish-standards.md` and links to it or a project-owned copy, preserving the
file's existing content and style. If `AGENTS.md` is a symlink to `CLAUDE.md`, edit
only the target. Never change these files without explicit consent.

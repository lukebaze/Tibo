# UI Testing Workflow

Use `ak:agent-browser` for live browser interaction when a fresh/tool-managed browser is enough. Use `ak:chrome-profile` only when the test needs the user's real Chrome profile, cookies, or already-logged-in state. Use `ak:web-testing` or project-native Playwright/Vitest/k6 commands for repeatable test runs.

## Purpose
Run comprehensive UI tests on a website and generate a detailed report.

## Arguments
- $1: URL - The URL of the website to test
- $2: OPTIONS - Optional test configuration (e.g., --headless, --mobile, --auth)

## Testing Protected Routes (Authentication)

### Step 1: User Manual Login
Instruct the user to:
1. Open the target site in their browser
2. Log in manually with their credentials
3. Open browser DevTools (F12) → Application tab → Cookies/Storage

### Step 2: Persist Auth State Or Select The Chrome Profile
Prefer project-native auth helpers for repeatable tests. For ad-hoc browser driving with real user auth/cookies, invoke `ak:chrome-profile` and run:

```bash
chrome-profile doctor
chrome-profile setup
chrome-profile list
```

If real user Chrome state is not needed, use `agent-browser` state commands after manual login when available.

### Step 3: Run Tests
After auth is available, run tests normally. If real user Chrome state is not needed:
```bash
agent-browser open https://example.com/dashboard
agent-browser screenshot -o profile.png
```

If real user Chrome state is needed:

```bash
chrome-profile open --json work https://example.com/dashboard
```

Then select the MCP page whose URL contains the returned `bind_selector` such as `cdp-open=<token>`, verify it also contains `cdp-profile=work`, and capture screenshots or snapshots through the active bridge.

This restriction applies only when real user Chrome state is required. For profile-scoped testing, do not use raw Chrome MCP `new_page` or `navigate_page` as the opening path. Those tools use whichever profile/page the bridge currently targets.

## Workflow
- Use `ak:plan` skill to organize the test plan & report
- All screenshots saved in the same report directory
- Browse URL, discover all pages, components, endpoints
- Create test plan based on discovered structure
- Use multiple `tester` subagents in parallel for: pages, forms, navigation, user flows, accessibility, responsive layouts, performance, security, seo
- Use `ak:ai-multimodal` to analyze all screenshots
- Generate comprehensive Markdown report
- Ask user if they want to preview with `/ak:preview`

## Output Requirements
- Clear, structured Markdown with headers, lists, code blocks
- Include test results summary, key findings, screenshot references
- Lead with the outcome. Keep reports short by being selective, not by compressing the writing into fragments or arrow chains; write complete sentences.

**Do not** start implementing fixes.

## Optional semantic regression experiment

The ordinary UI workflow above remains unchanged. Only for a requested shadow
experiment with an explicit user `ui-regression` consumer grant, use
`ak eval ui capture.json --mode shadow --json`. Default mode is `off`; ambient
credentials do not authorize inference. The command consumes reviewed compact
text from already-observed DOM, accessibility, computed layout, console/network,
viewport and journey evidence. Missing surfaces are `null`, observed empty
surfaces are `[]`. Never paste HTML, cookies, input values, raw console payloads,
URLs with credentials, screenshots or video. Use local opaque journey IDs.
An optional `vision_description` may reuse a description from the existing
native-vision/multimodal investigation; do not perform extra vision extraction
solely to feed the experiment. Review all text for private business/user data;
redaction is defense in depth, not permission to upload it.

Keep browser and accessibility outcomes in `deterministic` and preserve them in
the final report. A semantic probability never converts failures to passes or
cancels existing investigations. Save assertion results with `--output` to a new
local file; add an earlier report as `previous` only for the same journey/device
and observed surfaces. Comparable completed observations also require the same
assertion version, provider and model. Low probabilities and downward shifts
are signals, not confirmed regressions.

Example: `error-recovery` becomes an anomaly after a failed checkout request.
Follow the report's hypothetical handoff: reproduce the checkout with the
existing browser workflow, inspect visible retry controls and accessibility
announcements, then inspect an existing screenshot with native vision or the
installed multimodal capability when visual evidence is needed. Record whether
that investigation confirms or rejects the signal. The command never launches
these calls, skips screenshots, or changes the current UI test result.

Use `ak eval ui-benchmark corpus.json --json` for offline independently labeled
journeys. Synthetic protocol fixtures test integration, not model effectiveness.
Separate useful/false/missed signals and unknown coverage from recorded baseline
versus matched semantic measurements; unknown costs and missing call counts
remain unknown. Never call hypothetical investigation counts actual savings.

---
name: ak-test
description: "Run unit, integration, e2e, and UI tests. Use for test execution, coverage analysis, build verification, visual regression, and QA reports."
user-invocable: true
when_to_use: "Invoke for running or designing validation suites."
category: workflow
keywords: [test, unit, integration, e2e, coverage]
argument-hint: "[context] OR ui [url] OR create|optimize|audit [scope] [--advice] [--ultra] [--interview]"
metadata:
  author: agentkit
  version: "1.2.1"
  workflow:
    precedes: [ak-git]
---

# Testing & Quality Assurance

Comprehensive testing framework covering code-level testing (unit, integration, e2e), UI/visual testing via browser automation, coverage analysis, and structured QA reporting.

## Default (No Arguments)

If invoked with context (test scope), proceed with testing. If invoked WITHOUT arguments, use `ask_user capability` to present available test operations:

| Operation | Description |
|-----------|-------------|
| `(default)` | Run unit/integration/e2e tests |
| `ui` | Run UI tests on a website |
| `create` | Scout the codebase + docs, then create a covering test suite |
| `optimize` | Parallel-scout CI/CD, git history, codebase + docs, then cut test cost/time safely |
| `audit` | Inspect the suite + CI and report evidence-backed findings |

Present as options via `ask_user capability` with header "Test Operation", question "What would you like to do?".

## Core Principle

**NEVER IGNORE FAILING TESTS.** Fix root causes, not symptoms. No mocks/cheats/tricks to pass builds.

`references/practical-principles-for-setting-up-and-running-tests.md` is the
authority for scope, layer, environment, and execution choices. Every workflow
and operation below assumes it; load it before designing or changing tests.

## When to Use

- **After implementation**: Validate new features or bug fixes
- **Coverage checks**: Assess coverage against repository thresholds and critical behavior
- **UI verification**: Visual regression, responsive layout, accessibility
- **Build validation**: Verify build process, dependencies, CI/CD compatibility
- **Pre-commit/push**: Final quality gate

## Workflows

### 1. Code Testing (`references/test-execution-workflow.md`)

Execute test suites, analyze results, generate coverage. Supports JS/TS (Jest/Vitest/Mocha), Python (pytest), Go, Rust, Flutter. Includes working process, quality standards, and tool commands.

**Load when:** Running unit/integration/e2e tests, checking coverage, validating builds

### 2. UI Testing (`references/ui-testing-workflow.md`)

Browser-based visual testing via `ak:agent-browser`, `ak:chrome-profile`, `ak:web-testing`, or project-native Playwright/Vitest/k6 commands. Covers screenshots, responsive checks, accessibility audits, form automation, and console error collection.

**Load when:** Visual regression testing, UI bugs, responsive layout checks, accessibility audits

### 3. Report Format (`references/report-format.md`)

Structured QA report template: test results overview, coverage metrics, failed tests, performance, build status, recommendations.

**Load when:** Generating test summary reports

### 4. Suite Creation (`references/create-suite-workflow.md`)

`create`: activate `ak:scout` over the codebase and docs, map features and
workflows to a coverage matrix, then design and implement a test suite that
covers them.

**Load when:** `create` argument — bootstrapping or extending a test suite

### 5. Suite Optimization (`references/optimize-suite-workflow.md`)

`optimize`: multiple parallel `ak:scout` subagents analyze CI/CD workflows, git
history, codebase, and docs, then restructure tests for speed at equal safety —
parallel lanes, change-based test selection, docs-only skips. Goal: lower CI
cost, faster ships, no lost coverage. For repository-owned manifests, the same
workflow uses `ak test optimize` for deterministic ranked selection and optional
execution; external uncertainty broadens and mandatory policy checks remain.
Explicitly consented semantic shadow/advisory modes can add observations or
checks; they never remove the deterministic baseline. Never infer that consent
from a key, and never change E2E scheduling from classification advice.

**Load when:** `optimize` argument — CI too slow/expensive, suite growth pains

### 6. Suite Audit (`references/audit-suite-workflow.md`)

`audit`: multiple parallel `ak:scout` subagents analyze the test suite and
CI/CD workflows, detect deceptive or weak tests (tests written only to pass,
commented-out/skipped tests, unfinished tests, redundant or outdated tests,
security gaps), then report ranked findings and proposed repairs. Audit alone does not authorize edits.

**Load when:** `audit` argument — trust or quality concerns about the suite

### 7. Test Principles (`references/practical-principles-for-setting-up-and-running-tests.md`)

The eleven governing rules for every operation: test what your system owns,
scope by risk, test at the lowest reliable layer, isolate environments, run
sequentially by default, run expensive tests with a purpose, keep concurrency
tests deterministic, never game the green build, investigate failures with
evidence, test the final code, and keep tests in sync with specifications.

**Load when:** choosing test scope, layer, or environment; deciding whether a
slow, flaky, or parallel test earns its place; triaging a failure; or
reconciling tests with changed specifications. Any suite change, optimize or
audit proposal, or QA report must be consistent with these rules.

## Quick Reference

```
Principles     → practical-principles-for-setting-up-and-running-tests.md
  Scope, layer, environment, sequential vs parallel, expensive tests, failure triage

Code tests     → test-execution-workflow.md
  npm test / pytest / go test / cargo test / flutter test
  Coverage: npm run test:coverage / pytest --cov

UI tests       → ui-testing-workflow.md
  Screenshots, responsive, a11y, forms, console errors
  Auth: chrome-profile for real user login/cookies, or project-native test setup

Reports        → report-format.md
  Structured QA summary with metrics & recommendations
```

## Working Process

1. Identify testing scope from recent changes or requirements
2. Run the narrowest relevant check; add typecheck/build when it covers the affected contract
3. Execute appropriate test suites
4. Analyze results — focus on failures
5. Generate coverage reports if applicable
6. For frontend: run UI tests via `ak:agent-browser`, `ak:chrome-profile`, `ak:web-testing`, or project-native browser tests
7. Produce structured summary report

## Tools Integration

- **Test runners**: Jest, Vitest, Mocha, pytest, go test, cargo test, flutter test
- **Coverage**: Istanbul/c8/nyc, pytest-cov, go cover
- **Browser**: `ak:agent-browser` for live browser interaction without real user cookies; `ak:chrome-profile` for the user's actual Chrome login state, opened with `chrome-profile open --json` and bound by the returned selector; `ak:web-testing` or project-native Playwright/Vitest/k6 for repeatable UI tests
- **Analysis**: `ak:ai-multimodal` skill for screenshot analysis
- **Debugging**: `ak:debug` skill when tests reveal bugs requiring investigation
- **Thinking**: `ak:fable-thinking` skill for complex test failure analysis

## Quality Standards

- All critical paths must have test coverage
- Validate happy path AND error scenarios
- Ensure test isolation — no interdependencies
- Tests must be deterministic and reproducible
- Clean up test data after execution
- Never ignore failing tests to pass the build

## Report Output
Use the repository report location when a durable report is needed; return concise results directly for a small run.

Use naming pattern from `## Naming` section injected by hooks.

## Team Mode

When operating as teammate:
1. Discover the live task-management surface and the live team-coordination surface
2. Claim the assigned or next unblocked item when supported; otherwise read and update the active plan
3. Read the full work description before starting and wait for implementation prerequisites
4. Respect file ownership — only create/edit test files assigned
5. When done, record completion and report results through the live team surface

Plan files are the durable source of truth when runtime task tracking is absent
or session-scoped.

## Workflow Position

**Typically follows:** `/ak:cook` (test after implementation), `/ak:fix` (test after bug fix)
**Typically precedes:** `ak-git` (commit once tests pass)
**Related:** `/ak:cook` (implement then test), `/ak:fix` (fix then test)

## Flags (create / optimize / audit)

- `--advice` — run under `kongming` advisory supervision (see below).
- `--ultra` — run the analysis/design step as a best-of-5 verifier pass (see
  Ultra Verifier Mode).
- `--interview` — before applying any change, list every proposed change
  (tests added/removed/rewritten, CI workflow edits) with a one-line reason and
  interview the user via `ask_user capability` — one decision per change group;
  apply only the approved changes. Without `--interview`, `create` and `optimize` apply directly and report the full change list; `audit` reports findings unless repair was separately requested.

## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
`kongming` is an advisory-only supervisor: it returns counsel, never code, and
the main agent stays responsible for every decision, edit, and gate.

Spawn `kongming` at these checkpoints: after the scout/analysis phase (pass the
coverage matrix or findings and ask for a go/no-go plus the top risk); before
applying suite or CI workflow changes (pass the proposed change list); and when
stuck. Invoke with
`delegate_agent capability(subagent_type="kongming", prompt="<task, evidence, approaches tried, the exact question>", description="advice: <checkpoint>")`.
`--advice` never bypasses the failing-test rules or CI safety gates.

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present with `create`, `optimize`, or `audit`, run the
analysis/design step as a best-of-5 verifier pass: one immutable evidence
packet (scout reports, CI timings, git history summary), exactly five
independent read-only candidates in one parallel wave, one strongest-model
verifier.

- `create`/`optimize`: the verifier selects the single winning suite design or
  optimization plan unchanged (or rejects all); implementation runs once from
  the winner.
- `audit`: the verifier returns the
  evidence-validated, deduplicated union of audit findings across the five
  candidates — a real deceptive test may be caught by only one candidate;
  repairs run once on the union.

Full mechanics are in `../ak-brainstorm/references/ultra-verifier-mode.md`. It
is a best-of-5 verifier mode inspired by LLM-as-a-Verifier, not the full
framework. `--ultra` composes with `--advice` and `--interview`.

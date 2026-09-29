# Deep Workflow

Full pipeline with research, brainstorming, and planning for complex issues.
Discover the live task-management surface and use it for dependency tracking
when available. Otherwise, update the active plan. Plan files are the durable
source of truth.

The parent skill's opening intent frame is already satisfied. The brainstorm in
this route is a later solution decision grounded in diagnosis; it does not
replace or repeat the opening contract.

## Plan Setup (Before Starting)

Record phase dependencies upfront. Steps 1+2+3 may run in parallel when the
runtime permits the needed delegation.

- Scout codebase
- Diagnose root cause
- Research solutions
- Brainstorm approaches, blocked by scout + diagnose + research
- Create implementation plan, blocked by brainstorm
- Implement fix, blocked by plan
- Verify + prevent, blocked by implementation
- Code review, blocked by verification
- Finalize & docs, blocked by review

## Steps

### Step 1: Scout Codebase (parallel with Steps 2+3)
Record the scout phase as active.

**Mandatory:** Activate `ak:scout` skill or, when delegation is permitted,
launch 2-3 `Explore` subagents in parallel through `delegate_agent`. In Codex
Desktop, expose deferred multi-agent tools with `tool_search` first, then use
`multi_agent_v1.spawn_agent(agent_type="Explore", message="...")`.

Map: all affected files, module boundaries, call chains, test coverage gaps.

See `references/parallel-exploration.md` for patterns.

Record the scout phase as completed after its evidence is captured.
**Output:** `✓ Step 1: Scouted - [N] files, system impact: [scope]`

### Step 2: Diagnose Root Cause (parallel with Steps 1+3)
Record the diagnose phase as active.

**Mandatory skill chain:**
1. **Capture pre-fix state:** Record ALL error messages, failing tests, stack traces, logs.
2. Activate `ak:debug` skill (systematic-debugging + root-cause-tracing).
3. Use `ak:fable-thinking` (sequential mode) only when a decision/evidence log would help — structured hypothesis formation.
4. Use delegated `Explore` subagents to test hypotheses only when delegation is explicitly requested/permitted.
5. If 2+ hypotheses fail → auto-activate `ak:problem-solving`.
6. Trace backward through call chain to ROOT CAUSE origin.

Use the root-cause checklist in the parent skill as the diagnosis protocol.

Record the diagnose phase as completed after the root cause is proven.
**Output:** `✓ Step 2: Diagnosed - Root cause: [summary], Evidence: [chain]`

### Step 3: Research (parallel with Steps 1+2)
Record the research phase as active.
Use `researcher` through `delegate_agent` only when delegation is explicitly requested/permitted.

- Search latest docs, best practices
- Find similar issues/solutions
- Gather security advisories if relevant

Record the research phase as completed after relevant evidence is retained.
**Output:** `✓ Step 3: Research complete - [key findings]`

### Step 4: Brainstorm
Record brainstorming as active after scout, diagnosis, and research are complete.
Activate `ak:brainstorm` skill.

- Evaluate multiple approaches using scout + diagnosis + research findings
- Consider trade-offs
- Compare each option with the opening constraints, non-goals, and acceptance
  criteria
- Resolve the preferred direction; explicit auto mode may use the documented
  recommendation without a routine pause

Record brainstorming as completed after the direction is resolved.
**Output:** `✓ Step 4: Approach selected - [chosen approach]`

### Step 5: Plan
Record planning as active.
Use delegated `planner` only when delegation is explicitly requested/permitted;
otherwise write the plan locally.

- Break down into phases
- Identify dependencies
- Define success criteria
- Include prevention measures in plan

Record planning as completed after the durable plan is written.
**Output:** `✓ Step 5: Plan created - [N] phases`

### Step 6: Implement
Record implementation as active.
Implement the cause-aligned plan. Use context or reasoning aids only when their specific capability is needed.

- Fix ROOT CAUSE per diagnosis — not symptoms
- Follow plan phases
- Minimal changes per phase

Record implementation as completed.
**Output:** `✓ Step 6: Implemented - [N] files, [M] phases`

### Step 7: Verify + Prevent
Record verification as active.

**Mandatory skill chain:**
1. **Iron-law verify:** Re-run EXACT commands from pre-fix state. Compare before/after.
2. **Regression test:** Add comprehensive tests. Tests MUST fail without fix, pass with fix.
3. **Side-effect sweep (HARD-GATE-NO-SIDE-EFFECTS):** Walk each dependent caller of changed functions from Step 1 blast-radius. Run tests in modules that share files/contracts. Confirm public contracts (signatures, schemas, APIs, env vars) unchanged. See SKILL.md HARD-GATE-NO-SIDE-EFFECTS.
4. **Defense-in-depth:** Apply all relevant prevention layers from the parent skill.
5. **Verification commands:** Run typecheck + lint + build + test through `run_shell`; delegate only when explicitly requested/permitted.
6. **Edge cases:** Test boundary conditions, security implications, performance impact.

**On regression / side effect:** repair implementation-caused failures within scope; ask only for a changed contract or unauthorized action. Under `--advice`, obtain counsel first.

**If verification fails:** Loop back to Step 2 (re-diagnose). Max 3 attempts → question architecture.

Under `--advice`, a failed check is an objective `kongming` trigger: STOP and spawn `kongming` with the command, its output, and what you tried before re-diagnosing; never self-reason past a red check.

Use the prevention checklist in the parent skill.

Record verification as completed only after fresh evidence passes.
**Output:** `✓ Step 7: Verified + Prevented - [before/after], [N] tests, [M] guards`

### Step 8: Code Review
Record review as active.
Use delegated `code-reviewer` only when delegation is explicitly requested/permitted; otherwise review locally.

See `references/review-cycle.md` for mode-specific handling.

Record review as completed after accepted findings are resolved.
**Output:** `✓ Step 8: Review [score]/10 - [status]`

### Step 9: Finalize
Record finalization as active.
- Report summary: root cause, evidence chain, changes, prevention measures, confidence score
- Activate `ak:project-management` for task sync-back, plan status updates, and progress tracking
- Evaluate docs impact; use delegated docs-manager only for affected authority
  surfaces and git-manager only when explicitly requested/permitted
- Run `/ak:journal` — unless the shared "Journal step — opt-out" applies (see SKILL.md; skip when `--skip-journal` or `journal.auto=false`)

Record finalization as completed in the live surface when available and in the active plan.
**Output:** `✓ Step 9: Complete - [actions taken]`

## Skills/Subagents Activated

| Step | Skills/Subagents |
|------|------------------|
| 1 | `ak:scout` OR parallel `Explore` subagents when delegation is permitted |
| 2 | `ak:debug`, `ak:fable-thinking` (sequential mode), optional delegated Explore when permitted, optional `ak:problem-solving` when stuck |
| 3 | `researcher` via `delegate_agent` when permitted |
| 4 | `ak:brainstorm` |
| 5 | `planner` |
| 6 | `ak:problem-solving`, `ak:fable-thinking` (sequential mode), `ak:context-engineering` |
| 7 | `run_shell` verification; optional delegated tester when permitted |
| 8 | `code-reviewer` via `delegate_agent` when permitted, otherwise local review |
| 9 | `ak:project-management`; docs/git delegation only when permitted |

**Rules:** Don't skip steps. Validate before proceeding. One phase at a time.
**Frontend:** Use `ak:agent-browser`, Chrome MCP / `chrome-devtools-mcp`, or any relevant project-native browser tests to verify.
**Visual Assets:** Use `ak:ai-multimodal` for visual assets generation, analysis and verification.

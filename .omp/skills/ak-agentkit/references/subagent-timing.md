# Subagent Timing

When to spawn installed agents, what every delegation must carry, what may run
in parallel, and how dispatch differs per runtime. Roles here are resolved
against the LIVE installed inventory (Step 2) — example agent names are
illustrations from common AgentKit installs, not a roster to assume.

## Why (and why not) delegate

A subagent adds value through exactly four mechanisms: a fresh context window
(no accumulated noise), an enforced tool boundary, parallel wall-clock, or a
specialist system prompt. If a spawn provides none of these, do the work
inline.

Do NOT spawn when:

- The work is a single small edit or lookup (delegation overhead > work).
- The task needs the full conversation history to be done right — subagents
  start blank; the contract below is ALL they know.
- The user is mid-dialogue on the same question (interactive loops stay in
  the controller).
- The expected coordination cost exceeds the useful work.

## Optional delegation opportunities

| Stage | Condition | Role (examples) |
|---|---|---|
| understand | Independent areas whose mapping benefits from parallelism | explorer, read-only, in parallel (`Explore`, `scout`) |
| understand | External tech or unknown API involved | researcher (`researcher`) |
| decide | size epic, multi-file build ahead | planner (`planner`) — prefer the planning skill instead when the user should review the plan |
| decide | Approach contested or high-stakes | second-opinion role (`brainstormer`) with an adversarial prompt |
| execute | Independent file sets across phases | implementer per phase (`fullstack-developer`), disjoint ownership, parallel only when files do not overlap |
| execute | Marketing: multiple channels from one brief | one content role per channel (`content-creator`, `copywriter`, `email-wizard`, `social-media-manager`) |
| verify | Independent validation adds coverage beyond direct checks | tester (`tester`) |
| verify | Ship/publish/public-contract ahead, or risk high | independent reviewer (`code-reviewer`, `content-reviewer`) |
| any | Same failure twice despite fixes | debugger with all evidence so far (`debugger`, `campaign-debugger`) |
| any | Hard problem on a model below `fable` (stuck after retries, high-stakes fork) | strategist (`kongming`) — autonomous counsel from the strongest model in one reply; no user round-trips |
| deliver | Behavior, setup, or commands changed | docs role (`docs-manager`) |
| deliver | Durable lesson, incident, or hard failure worth recording | journal role (`journal-writer`) |
| any | Data pull or analysis too large for the main context | analyst (`analytics-analyst`, `database-admin`) |

Select delegation only when allowed by the active runtime and user instructions. Direct verification satisfies routine work; explicit advice/ultra modes retain their own contracts.

## Delegation Contract

Every spawn carries all seven. A subagent cannot see the conversation; this
contract is its entire world:

1. **Task** — one outcome, verifiable.
2. **Files to read** — exact paths, not "look around" (unless scouting IS the task).
3. **Files it may modify** — explicit ownership; empty for read-only roles.
4. **Acceptance criteria** — how the agent knows it is done.
5. **Constraints** — patterns to follow, things not to touch, no commit/push
   unless the controller owns git ops and says so.
6. **Report path** — where to write findings when the project keeps reports
   (`plans/reports/` convention when present); otherwise return in the result.
7. **Status line** — end with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED |
   NEEDS_CONTEXT` plus a one-line summary.

Handle `BLOCKED` / `NEEDS_CONTEXT` by changing the context, scope, or approach
before re-delegating. Re-sending a failing prompt unchanged is a loop, not a
retry.

## Parallel Safety

- Parallel agents require disjoint file ownership, decided BEFORE spawning.
- Never parallel-edit the same file, generated artifact, migration sequence,
  or shared config.
- Read-only explorers parallelize freely.
- Merge decisions, conflict resolution, and user approvals stay in the
  controller session.
- Keep concurrent spawns to a handful (3-4); a wall of agents burns quota and
  produces reports faster than you can verify them.

## Runtime dispatch

Resolve agent capabilities through the runtime's current tool catalog. Use native delegation when exposed; use a registered AgentKit agent runtime only when actually available. Do not assume subprocess latency, model availability or tool names from another host, and do not install/register or restart a runtime merely to delegate routine work. If no suitable capability is present, execute directly and identify a material review gap when one remains.

## Reporting Back

The controller reports outcome-first after agents return: what each role
produced, what was verified, which reports exist where, and any
`DONE_WITH_CONCERNS` items verbatim — concerns from fresh-context agents are
signal, not noise.

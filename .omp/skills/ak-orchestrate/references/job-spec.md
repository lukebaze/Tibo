# Job Spec

`/ak:orchestrate` accepts YAML or turns a free-form request into YAML under the
run report directory. This file owns the durable data shape and execution
semantics. It does not own a runtime roster, model catalog, or provider route.

Resolve every runtime, model, agent, flag, and safety control from live evidence
before dispatch:

- [runtime-matrix.md](runtime-matrix.md): live candidate evidence;
- [model-routing.md](model-routing.md): the sole selection policy;
- [harness-profiles.md](harness-profiles.md): control evidence;
- [internal-routing.md](internal-routing.md): in-session agent mechanics.

## Schema

```yaml
version: 1
concurrency: 2
workspace_roots: [<authorized-workspace-root>]
defaults:
  timeout: 10m
  effect: observe
  approval: inherit
  capture: true
jobs:
  - id: string
    runtime: string
    agent: string
    fallback_runtime: [string]
    task: scout | architecture | implement | review | audit | security | test | docs | mechanical
    importance: normal | high
    model: string
    cwd: string
    prompt: string
    skill: string
    allowed_tools: [string]
    disallowed_tools: [string]
    effect: observe | scoped-write | high-impact-write | external-destructive
    approval: inherit | require
    isolation: none | worktree
    timeout: 10m
    expected_output: string
    depends_on: [job-id]
    destructive: false
    checks: [string]                 # descriptive acceptance requirements
    authority: <existing-user-authorization-reference>
    owned_paths: [<relative-owned-path>]
    inputs:
      - path: <relative-input>
        sha256: <optional-expected-hash>
      - path: <relative-handoff-destination>
        from_job: <dependency-id>
        from_path: <declared-dependency-output>
    outputs:
      - path: <relative-artifact>
    invocation:                     # resolved CLI jobs only
      command: <verified-executable>
      args: [<verified-argument>]
    verification:                   # executable acceptance checks
      - command: <verified-check-executable>
        args: [<check-argument>]
    retry:
      max_attempts: 1
      backoff: 5s
      classes: [<retryable-class>]
    max_output_bytes: 1048576
```

Candidate identifiers are opaque strings until the current run verifies them.
`agent` is meaningful only for in-session dispatch. `skill` is meaningful only
for the AgentKit skill-run branch. Do not copy a candidate list into this file.

`effect` and `approval` are normalized coordinator intent, not runtime flags.
The live harness profile maps them to verified native sandbox, permission, and
approval controls. Block a route when no verified mapping meets its risk tier.

## Required Fields

Every job includes:

- `id`, `runtime`, and `cwd`;
- exactly one executable intent through `prompt` or `skill`;
- `timeout` or `defaults.timeout`;
- `expected_output`;
- `model` or a routable `task`.

When `model` is present it is an explicit constraint, not proof of availability.
The live inventory gate still applies. Internal model selection is allowed
only when the current native dispatch interface proves that capability.

`isolation: worktree` is required for parallel writers in one repository and
for any write whose verified harness controls do not otherwise satisfy the
assigned risk tier. Worktree isolation prevents edit collisions; it does not
claim to be an operating-system sandbox.

`importance: high` raises capability and risk floors according to
[model-routing.md](model-routing.md). This schema never names the resulting
model or reasoning setting.

## Validation

Before stage construction:

1. Reject duplicate or unsafe job IDs and unknown dependency IDs.
2. Reject dependency cycles.
3. Resolve `cwd` and ensure it stays within the authorized workspace.
4. Require bounded timeout and capture for every job.
5. Verify each primary and fallback runtime in the live matrix.
6. Map effect, approval, and tool constraints to verified native controls.
7. Verify explicit model and agent constraints.
8. Reject parallel write overlap unless file ownership is disjoint and each
   writer has the required isolation.
9. Bind external/destructive work to existing scoped user authorization; ask
   only when the required scope has not been authorized. Never infer permission
   from an arbitrary nonempty authority string.

Unknown flags, models, or controls fail validation. Re-read live help or current
official documentation; never guess a replacement.

## Execution Semantics

- Jobs with no dependencies form the first stage.
- A job starts only after every dependency succeeds.
- A stage may run up to `concurrency` jobs when ownership and isolation allow.
- Failed or timed-out dependencies block their dependents.
- Default is one attempt. An explicit bounded retry policy permits only named
  failure classes after confirmed settlement and unchanged owned/input state.
  External/destructive effects and uncertain writers never retry automatically.
- Fallback selection reruns the full capability and risk gate for that runtime.
- Every state transition is atomically persisted before the next dispatch.

## Executable preparation and state

The owning schema and validation are
`apps/cli/internal/runtime/orchestrateplan/types.go` and its validators; the
supervisor graph is `apps/cli/internal/runtime/orchestrate/digest.go`. This
reference explains their use rather than maintaining another state schema.

After live routing, add authorized `workspace_roots`, relative `owned_paths`,
explicit `inputs`/`outputs` and a verified `invocation` for each CLI job. Keep
secrets out of the spec. `verification` contains executable argv arrays;
`checks` alone is descriptive and does not execute a shell command. Include a
report file among outputs for read-only/native jobs so acceptance is inspectable.

```bash
ak orchestrate prepare <jobs.yaml> <run-dir> --json
ak orchestrate advance <run-dir> --json
ak orchestrate plan-status <run-dir> --json
ak orchestrate accept <run-dir> <job-id> --attempt <attempt-id> --result <receipt.json> --json
```

`prepare` creates private immutable resolved input and state. `advance`
reconciles execution attempts and returns newly dispatchable native jobs plus
supervisor run IDs. A completed CLI attempt waits for explicit artifact
acceptance. Invoke again after observed transitions;
it does not run an autonomous model-selection loop. `accept` binds a native
receipt to the exact attempt; inspect its installed help and receipt type for
required fields. Native completion claims still require artifact and check
verification. Never fabricate process exit codes for native work.

Declared verification commands run under a persisted supervisor run. Acceptance
may report verification pending; retain the same receipt and repeat `accept`
after observing its run. A client interruption never authorizes a second set
of checks. On hosts without process supervision, declared subprocess checks
remain unsupported rather than silently losing their deadline guarantee.

Record selected route separately from receipt `observed` identity and its
evidence source. Unknown actual provider/model stays absent; executable names
and requested flags do not attest which model performed the work.

State persists intended supervisor IDs before launch. Resume through `advance`
instead of creating another run. A launch whose outcome cannot be proved keeps
its ownership blocked. Successful results are reusable only while base revision,
input fingerprints and output hashes remain valid; stale prerequisites invalidate
dependent results and the arbiter. Do not edit the prepared spec in place.

Create worktrees before preparation. Paths are relative to each job's cwd and
must remain within its authorized root. A handoff names a dependency's declared
output and copies verified bytes to a declared destination. Conflicting content
is preserved and reported; the engine does not silently merge code or overwrite
user files. Integration of source patches remains coordinator-owned.

Retries retain attempt identity/history and backoff state. They require a settled
prior writer and unchanged relevant fingerprints; a crash, orphan, lost native
handle or uncertain external side effect is a reconciliation problem, not a
retryable provider failure. Record prior authority once and respect its scope.

## Raw supervisor graphs

For low-level CLI-only work, `start <graph.json>` and `resume <run-id> <graph>`
remain available. A graph uses command/argument arrays, cwd, dependencies,
`timeout_ms`, `max_output_bytes`, `attempt_id` and observational route metadata.
The graph-level `concurrency` bounds active jobs. A zero deadline remains a
legacy low-level behavior; the prepared plan requires explicit bounded timeouts.

When translating a subset of a larger DAG, include only dependencies inside
that subset. Remove an outside dependency **only after its accepted artifacts
and checks are verified**. Never preserve a dangling ID or silently discard an
unsatisfied edge. Internal jobs never become fake subprocess graph nodes.

Process spawn, identity, deadline, signal escalation and capture belong to the
supervisor on supported platforms. Poll `status` until `all_settled`; aggregate
failure can coexist with running siblings. Stop through `ak orchestrate stop`,
never through a stored PID. Resume verifies the original launch digest and does
not relaunch a process tree.

## Capture contract

Use the durable journal and bounded merged job log via `events`, `output` and
`diagnose`; see [observation.md](observation.md). Raw graph files persist private
argv/env for worker recovery and are excluded from diagnostic exports. Do not
claim they never exist on disk. Capture redaction precedes disk writes; explicit
truncation means later content may be absent. Native output remains an artifact
with its real handle and a null subprocess exit code.

## Arbiter Contract

The coordinator reports `Arbiter: pass` only when:

- every required job succeeded;
- expected outputs and listed checks exist and pass;
- outputs do not contain unresolved contradictions;
- claims are supported by available evidence;
- unresolved questions are absent or explicitly accepted.

The arbiter route must satisfy the judgment floor in
[model-routing.md](model-routing.md). Independence is verified from the live
inventory, not asserted from a copied provider name.

## Illustrative Spec

Placeholders below must be resolved and verified before dispatch.

```yaml
version: 1
concurrency: 2
jobs:
  - id: scout-contract
    runtime: "<verified-read-runtime>"
    task: scout
    cwd: "<workspace-root>"
    prompt: "Map the contract owners and cite source evidence."
    timeout: 8m
    expected_output: "Source-backed contract map."

  - id: inspect-tests
    runtime: "<verified-read-runtime>"
    fallback_runtime: ["<verified-fallback-runtime>"]
    task: test
    cwd: "<workspace-root>"
    prompt: "Identify copied inventories and propose source-derived gates."
    timeout: 8m
    expected_output: "Test-coupling report with file evidence."

  - id: arbiter
    runtime: "<verified-judgment-runtime>"
    task: review
    cwd: "<workspace-root>"
    prompt: "Reconcile both reports and reject unsupported claims."
    depends_on: [scout-contract, inspect-tests]
    timeout: 8m
    expected_output: "Verified arbiter verdict."
```

The execution schema is versioned independently of live routing. Update the owning routing or
runtime reference when selection policy or evidence changes; do not refresh
examples with a new catalog.

# Subagent orchestration in the vibe pipeline

The vibe controller stays the single owner of interpretation, taste, and every
gate. Subagents accelerate work and supply **fresh, unbiased context**; they do
not own decisions. Delegate through the runtime's parallel task capability
(`ak:orchestrate` / `ak:team` when a structured DAG or worktree isolation is needed).

## When to fan out to subagents

Fan out only across **genuinely independent slices** — work that can run at the
same time without waiting on each other's output.

- **Fresh-context reads (no write contention):** planning fanout, code-review
  fanout (e.g. `/ak:code-review --ultra`, `/ak:plan --ultra` best-of-5 waves),
  research, debugging investigation, test analysis, and advisory review. These
  are read-only or produce isolated artifacts, so they parallelize freely and
  avoid the single-context bias of one agent grading its own work.
- **Independent implementation slices:** only when each slice owns a disjoint
  set of files. Give every delegate an explicit, non-overlapping file-ownership
  boundary and the full slice requirements (subagents have no conversation
  history). For complex multi-file writes, prefer worktree-isolated subagents
  via `ak:orchestrate`.

## Safety rules (prevent stepping on each other)

1. **Disjoint file ownership.** Two concurrent writers in the same worktree
   MUST NOT touch the same file, because overlapping writes clobber each other.
   Partition by file/module before dispatch.
2. **Serialize the shared boundary.** If multiple slices need a shared file
   (schema, barrel export, config), name one integration owner and serialize
   that single mutation; other slices consume the agreed interface.
3. **Contracts up front.** Decide cross-slice interfaces (types, function
   signatures, API shapes) before fanning out and state them in the shared
   context, not left for delegates to negotiate mid-flight.
4. **Separate independent and shared checks.** Delegates run focused tests or syntax checks that read only stable owned inputs and write isolated outputs. Serialize shared build/lint/full-suite jobs while siblings edit; the controller verifies integrated boundaries after the wave rejoins.
5. **Scoped mutation.** Delegates edit strictly within their assigned file boundary.
   The controller performs the whole-worktree validation, git staging, and commit.
6. **Cap concurrency.** Stay within the runtime's concurrent-subagent cap; excess
   just queues and adds coordination cost.

## Reconvene

After each wave: the controller collects results, inspects the touched files,
runs the narrowest affected validation, and only then advances the pipeline. A
read-only scout may keep running while the controller integrates.

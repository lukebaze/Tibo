# Challenge Framework (`--ask` mode)

Use after scout + analyze, before scaffolding. Goal: pressure-test assumptions
and surface constraints. Cut requested scope only when the user passed
`--yagni`.

## Core questions (always ask)

1. **Why agentize this?** What unlocks when an AI agent (not a human) calls these operations? If the answer is "it'd be cool," stop.
2. **Who's the primary consumer?** AI agent, human via CLI, or both equally? This drives shape of outputs, error messages, verbosity.
3. **What's requested for v1?** Confirm the requested capabilities and separate
   them from additions discovered during analysis. Do not defer requested work
   unless the user passed `--yagni` or explicitly chooses to defer it.
4. **Read vs write split.** Which capabilities are read-only? Which mutate? Which are destructive? (affects auth, confirmation, MCP tool design)
5. **Where do values come from today?** Env? Vault? Hardcoded? This pins the resolution chain defaults.
6. **Deployment target.** Local-only (stdio + CLI), remote (Cloudflare), self-host (Docker), or all? Cost + ops implications differ.
7. **Package name and scope.** `@org/tool`? Public npm scope? License?
8. **Maintenance.** Who owns this after release? Release cadence? Deprecation policy?

## Architectural challenges

| Question | Red Flag | Green Flag |
| --- | --- | --- |
| Core extractable? | Business logic tangled with HTTP/CLI | Clear function boundaries |
| Side effects localized? | Scattered across modules | Isolated into clients |
| Async/long-running ops? | 30+ sec calls, no cancel | Quick calls or streaming progress |
| Auth complexity? | Multi-step OAuth dance per call | Static token or one-time login |
| Large outputs? | Megabyte responses typical | Pageable, filterable |
| Stateful workflows? | Requires client-side state machine | Each call self-contained |

## Cut-scope challenges (`--yagni` only)

Skip this section unless the user passed `--yagni`. Without the flag, use these
questions only to reject unrequested additions, never to remove requested work.

Ask for each proposed capability:
- Can an agent accomplish the user's goal without this one?
- Is this 80% covered by another capability?
- Does this leak internal model details the agent doesn't need?
- Is this a debug/admin op that does not belong on the public surface?

## Design challenges

- Are we mirroring HTTP endpoints instead of designing workflows?
- Is the concise response actually concise (<1 KB typical)?
- Do errors tell the agent what to do next, not just what broke?
- Are identifiers agent-friendly (names) or DB-friendly (UUIDs)?
- Would a human reading the tool description know when to use it?

## Decision matrix template

```markdown
| # | Decision            | Option A       | Option B       | Chosen | Why |
| - | ------------------- | -------------- | -------------- | ------ | --- |
| 1 | Transport           | stdio only     | stdio + Streamable HTTP | both   | remote deploy planned |
| 2 | Credential storage  | env only       | keychain+env   | both   | dev UX + prod safety |
| 3 | CLI framework       | commander      | cac            | commander | wider adoption |
| 4 | Test runner         | vitest         | jest           | vitest | speed + TS native |
| 5 | Deploy target v1    | Cloudflare     | Docker         | both   | CI cost is low |
```

## Stop conditions

Abort and propose an alternative if:
- Core cannot be extracted without significant refactor the user hasn't scoped
- With `--yagni`, no capabilities survive the cut-scope pass
- Legal/compliance blocks publishing (licensing of upstream deps, etc.)
- Credentials model requires interactive OAuth that can't run in the MCP transports

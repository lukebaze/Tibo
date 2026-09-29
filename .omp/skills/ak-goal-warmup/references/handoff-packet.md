# Handoff packet templates

Warmup **never** invokes `/goal` or starts a long-run session.

## Ready

```markdown
# Goal packet (from ak:goal-warmup)

## Outcome contract (LOCKED)
- Intended result: ...
- In scope: ...
- Out of scope: ...
- Acceptance signals: ...
- Constraints: ...
- Allowed substitutions: ...
- Decision owner: user

## Plan
- Path: <repo-relative or session>
- Contract traceability: present

## Preflight
- Blocking: none
- Deferred: <list or none>

## Scope guard (MUST follow during long-run)
At each phase boundary:
1. Diff proposed deliverables vs locked contract
2. If material mismatch → pause for user; do not finish under reduced scope
3. Do not weaken, skip, or delete tests to satisfy the stop condition
4. Pause for human decision instead of inventing product choices

## Codex opener
/goal Complete <intended result>.
Read first: <plan path>.
Constraints: <contract constraints + out of scope>.
Validate after each checkpoint: <acceptance commands>.
Keep a brief progress log.
Stop when <acceptance signals>, or when further work needs human input.
Follow the scope guard above.

## Claude long-run opener
Complete <intended result>.
Read first: <plan path>.
Honor the LOCKED outcome contract above.
Validate: <acceptance signals>.
At each phase boundary apply the scope guard.
Stop when done or when a human decision is required.
Do not auto-expand scope.
```

## Blocked

```markdown
# Goal warmup — Blocked

Unresolved blockers (only):
1. <requirement> — status: missing — action: <exact user action>
2. ...

Resume: re-run `/ak:goal-warmup` after supplying the above.
Do not start /goal until Ready.
```

## Decision required

```markdown
# Goal warmup — Decision required

## Trade-off
<what makes the locked outcome hard or infeasible>

## Options
1. <option> — consequences: ...
2. <option> — consequences: ...
3. Abort warmup

Reply with the option number. Warmup will re-lock the contract if outcome changes.
```

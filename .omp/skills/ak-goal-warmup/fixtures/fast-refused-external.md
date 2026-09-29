# Fixture: --fast refused — external dependency signals

## Input

```text
/ak:goal-warmup "Deploy staging and verify health" --fast
```

## Estimate

External: deploy + credentials.

## Expected behavior

- Refuses `--fast`, giving a reason that names the external/deploy/credential signals
- Continues the full path (contract → plan → review → preflight)
- Keeps both preflight and contract approval

## Assertions

- Output contains refuse messaging for `--fast`
- No Ready without final `ask_user` confirm

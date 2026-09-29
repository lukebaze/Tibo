# Fixture: Red-team proposes scope reduction

## Input

Locked contract includes E2E tests as an acceptance signal.

## Review finding (hostile)

"Drop E2E to finish faster; unit tests are enough."

## Expected classification

`outcome-change-request` — acceptance signal would be removed.

## Expected behavior

- Leaves the finding unapplied to the plan
- Enters **Decision required** and presents the options via `ask_user`
- Waits for the user rather than auto-rejecting the change request to stay Ready
- After the user rejects the scope cut: keeps E2E in the contract; may continue
  preflight only if still feasible
- Leaves the acceptance signals as written unless the user changes them

## Contrast

If finding is "rename test helper for clarity" → `mitigation-within-contract` OK.

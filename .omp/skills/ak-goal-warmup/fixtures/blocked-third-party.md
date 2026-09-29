# Fixture: Blocked — third-party access unavailable

## Input

Goal: "Integrate sandbox payments and run a test charge in sandbox."

## Preflight

| Phase | Requirement | Status | Unblock | Blocking? |
|-------|-------------|--------|---------|-----------|
| integration | third-party sandbox account | missing | user creates sandbox + API key | yes |
| integration | non-mutating connectivity | unknown | user confirms network/API access | yes |

## Expected terminal state

- Missing sandbox access with no approved alternative in Allowed substitutions →
  **Blocked**
- Contract assumed access that is infeasible without changing outcome →
  **Decision required** (options: obtain access / change contract / abort)

This fixture pins the first case: **Blocked**.

## Assertions

- Runs no chargeable or mutating API calls during preflight
- Uses non-mutating probes only, if it probes at all
- Leaves /goal unstarted
- Lists the exact unblock actions for the missing sandbox access

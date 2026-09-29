# Suite Creation Workflow (`create`)

Create a test suite that covers the project's features and workflows, grounded
in what the code and docs actually do — never in guessed behavior.

## 1. Scout the codebase and docs

Activate `ak:scout` (parallel Explore subagents when the runtime permits) over:

- entry points, public APIs, exported modules, CLI commands, HTTP routes;
- business workflows described in `docs/` and the README;
- existing tests (framework, layout, helpers, fixtures, naming conventions);
- configuration and environment surfaces that change behavior;
- error paths and boundary conditions visible in the code.

Output: a scout report listing features, workflows, and their owning files.

## 2. Build the coverage matrix

Map every discovered feature/workflow to its intended coverage:

| Feature / workflow | Owner files | Level (unit/integration/e2e) | Exists? | Priority |
| --- | --- | --- | --- | --- |

Rules:

- Prefer the lowest level that can prove the behavior (unit > integration > e2e).
- Every critical path gets happy-path AND error-path coverage.
- Reuse the project's existing framework and conventions — never introduce a
  second test framework beside a working one.
- Skip trivial plumbing (getters, pass-throughs); test behavior, boundaries,
  invariants, transitions, and real error handling.

## 3. Design before writing

For each matrix row without coverage, define: the observable contract under
test, the failure a plausible bug would cause, fixtures needed, and isolation
requirements (no cross-test dependencies, deterministic, full-suite-safe).

With `--interview`: present the matrix and the planned test list; interview the
user per group before writing. With `--ultra`: fan this design step per the
skill's Ultra Verifier Mode. With `--advice`: checkpoint the matrix with
`kongming` before implementation.

## 4. Implement

- Write tests group by group; run each group as it lands.
- Each test MUST fail on a plausible bug — spot-check by mutating the code
  under test once, watching the test fail, then reverting.
- Wire coverage tooling when the project already defines it; target the
  project's threshold (default 80% on critical paths).
- Never write a test that asserts nothing, mirrors the implementation line by
  line, or locks in buggy behavior to pass.

## 5. Verify and report

- Run the full new suite plus the pre-existing suite; both must be green.
- Report per `references/report-format.md`: matrix coverage before/after,
  tests added per level, gaps intentionally left (with reasons), and unresolved
  questions last.

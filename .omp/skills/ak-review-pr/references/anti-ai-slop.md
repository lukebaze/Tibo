# Anti AI-Slop Reference

Concrete taxonomy of "AI slop" code patterns the reviewer should flag, with detection heuristics, fix guidance, and calibration on when **not** to flag.

## Why this matters

LLM-assisted contributions often produce code that *compiles, passes tests, and looks reasonable per-file* — but pollutes the codebase at the aggregate. Common drivers:

- Low-quality LLMs that pattern-match without understanding constraints
- Contributors who don't read their own diffs before pushing
- Lack of engineering judgment to push back on agent suggestions
- Coding agents that prioritize "doing something" over "doing nothing when the right answer is no change"

The result is **code rác** (garbage code) and **code dư thừa** (redundant code) that look harmless individually but compound. This reference gives the reviewer the lens to spot it.

---

## Section 1: Structural slop (high impact — flag as **Important**)

One bad call here infects 100 files later. Always flag.

### 1.1 Dumping-ground new files
**Pattern**: New file at `utils/helpers.ts`, `lib/common/index.ts`, `services/manager.ts`, `core/utils.go`.
**Why bad**: Generic name = no domain anchor. The next agent dumps more there. Within 6 months it's a 2000-line junk drawer.
**Detection**: `git diff --name-status --diff-filter=A` for new files with generic names in dumping-ground dirs.
**Fix**: Rename to a domain-anchored name (`token-bucket-rate-limit.ts`, not `rate-limit-helper.ts`). Or move the function into the only file that calls it.

### 1.2 Parallel reimplementation
**Pattern**: New `formatDate()` / `slugify()` / `chunk()` / HTTP retry wrapper when the repo already has one.
**Why bad**: Two implementations diverge over time. Bugs get fixed in one but not the other.
**Detection**: Grep the repo for similar function names or behavior before approving any new utility.
**Fix**: Use the existing one. If the existing one is inadequate, *extend* it — don't fork it.

### 1.3 Premature abstraction
**Pattern**: New interface + factory + builder + adapter for a feature with one implementation and two callers.
**Why bad**: Abstraction cost (indirection, mental load, test surface) paid up front without the payoff (multiple implementations) that justifies it.
**Detection**: Count concrete implementations of any new interface. One = premature.
**Fix**: Inline the concrete type. Add the abstraction when the second implementation actually shows up.

### 1.4 Config flag for what should be a constant
**Pattern**: New env var or config field `ENABLE_X`, `USE_NEW_Y`, `FEATURE_Z_ENABLED` for behavior that should be hardcoded.
**Why bad**: Will never be turned off. Becomes documentation lag and a foot-gun. Doubles the test matrix.
**Detection**: Any new config field — ask "would we actually flip this in production? If no, why is it a flag?"
**Fix**: Pick the value, hardcode it. Delete the flag plumbing.

### 1.5 Schema/contract change without migration
**Pattern**: PR adds a NOT NULL column, renames a field, changes a response shape — no migration, no backward-compat shim.
**Why bad**: Breaks deployed clients or existing data.
**Detection**: Diff touches DB schema, API DTOs, public types, or persisted config formats.
**Fix**: Add migration, deprecation path, or version the contract.

### 1.6 God-file growth
**Pattern**: A 180-line file grows to 450 in one PR. Project's stated size limit (often 200 lines) ignored.
**Why bad**: Files become unreadable. Context loads become expensive. The next agent has even less room to work cleanly.
**Detection**: `wc -l` on modified files in the diff vs project size convention.
**Fix**: Split before merge. Group related additions into a new focused module.

### 1.7 Phantom dependencies
**Pattern**: `package.json` / `go.mod` / `requirements.txt` adds a dep — diff doesn't actually import it, OR imports it for one trivial call that the language stdlib already supports.
**Why bad**: Supply chain risk, install size, transitive vulnerabilities — all for nothing.
**Detection**: Cross-check dep additions against actual `import`/`require`/`use` lines in the diff.
**Fix**: Remove the dep, inline the trivial call, or use stdlib.

---

## Section 2: Micro slop (each instance small — flag as **Suggestion**)

Don't block merges, but call out. Aggregate is rot.

### 2.1 Defensive paranoia
**Pattern**: `try/catch` around code that cannot throw. Null checks on typed-non-null parameters. "Just in case" guards before stdlib calls that already validate.
**Fix**: Delete the guard. Trust the types and the stdlib.

### 2.2 Catch-and-swallow
**Pattern**: `catch (e) { console.log(e) }`, `catch { return null }`, `except: pass`.
**Fix**: Either handle the error meaningfully (retry, fallback, user message) or let it propagate. Logging-and-continuing is a bug factory.

### 2.3 Comment paraphrasing
**Pattern**: `// increment counter` next to `counter++`. `// returns the user's name` above `getUserName()`.
**Fix**: Delete. Comments should explain *why*, not narrate *what*.

### 2.4 Generic error messages
**Pattern**: `"An error occurred. Please try again."`, `throw new Error("Failed")`, `return errors.New("error")`.
**Fix**: Include the operation, the inputs, and the failure mode. `"failed to fetch user %d: %w"`.

### 2.5 One-line wrappers
**Pattern**: `function getName(u) { return u.name }`. Adds indirection, hides nothing.
**Fix**: Inline. Delete the wrapper.

### 2.6 Reimplementing stdlib
**Pattern**: Custom `chunk`, `range`, `groupBy`, `debounce`, `deepEqual` when language stdlib or an existing dep covers it.
**Fix**: Use the stdlib/dep. If you don't trust the dep, that's a separate decision worth flagging upward.

### 2.7 Silencing the linter
**Pattern**: `any` widening, `@ts-ignore`, `@ts-expect-error`, `// eslint-disable`, `# noqa`, `//nolint` introduced to hide a warning instead of resolving it.
**Detection**: `git diff | grep -E '^\+.*(any|@ts-ignore|@ts-expect-error|eslint-disable|noqa|nolint)'`
**Fix**: Resolve the underlying issue. Use these only with a comment explaining why the linter is wrong.

### 2.8 Phantom test coverage
**Pattern**: Tests that exercise lines without meaningful assertions: `expect(result).toBeTruthy()` on a value that's always truthy; `assert result is not None` when the function can't return None.
**Fix**: Assert on the actual behavior — value, side effect, error.

### 2.9 Mock-of-a-mock
**Pattern**: Tests where 80% of setup is mocking, and the assertions verify the mock got called — not that the SUT did the right thing.
**Fix**: Use real implementations where possible. Mock only at integration boundaries.

### 2.10 Unused symbols introduced
**Pattern**: New imports, exports, parameters, or variables in the diff that nothing references.
**Detection**: Language linter (`tsc --noUnusedLocals`, `go vet`, `pyflakes`, `ruff`).
**Fix**: Delete.

### 2.11 Magic numbers
**Pattern**: `if (retries > 7)`, `setTimeout(fn, 3600000)`, `if (status === 418)`.
**Fix**: Name the constant. `const MAX_RETRIES = 7`.

### 2.12 Style inconsistency
**Pattern**: New code uses arrow functions / camelCase / async-await / a different formatter than the rest of the file.
**Fix**: Match the surrounding file. The reviewer should not have to think about style.

---

## Section 3: Process slop (PR-level signals)

Look across the whole diff, not per-file.

### 3.1 Scope mismatch
**Signal**: PR title says "fix typo" but diff is +800/−60 across 12 files.
**What it means**: Author wasn't watching what the agent did, OR the title is wrong.
**Action**: Ask for the PR to be split into focused commits, or ask the author to rewrite the title/description.

### 3.2 Unrelated files
**Signal**: "Fix auth bug" PR also rewrites a logging helper, reorders imports in 5 unrelated files, bumps a dep.
**Action**: Ask the author to separate the unrelated changes into their own PR.

### 3.3 Tests missing or skipped
**Signal**: Production code changed; no test changes. Or test changes are `it.skip()` / `t.Skip()` / `@pytest.mark.skip` on previously-passing tests.
**Action**: Block until tests cover the new path, or the skips are justified in the PR description.

### 3.4 Docs claim features that don't exist
**Signal**: README, changelog, or doc updates describe behavior the diff doesn't implement.
**Action**: Either the docs are aspirational (remove), or the implementation is incomplete (block).

### 3.5 Commit messages with LLM-style fluff
**Signal**: Commits titled "Improve code quality and enhance maintainability", "Refactor for clarity", "Update various files".
**What it means**: Author didn't read the diff before committing.
**Action**: Informational. Mention it in the review — recommend conventional-commits format with the *actual* change described.

---

## Section 4: How to phrase the finding

Slop findings are *judgment calls*. Bug findings are not. The reviewer LLM tends to swing between "aggressive style cop" and "too polite to flag anything". Both fail.

### Good phrasing

- **State the cost, not the rule.** "This abstraction has one caller and one implementation — the indirection adds 15 lines of test surface without enabling a second use case. Consider inlining until a second caller appears."
- **Tie to a concrete future risk.** "Naming the file `utils/helpers.ts` invites future additions. Within 6 months this file tends to grow to 1000+ lines. Suggest renaming to `<domain-specific-name>.ts`."
- **Offer the alternative.** Don't just flag — say what good looks like.
- **Acknowledge it's a call.** "This is a Suggestion, not a blocker. If you have a use case in mind for the second implementation, leave it."

### Bad phrasing

- "This is AI slop." — accusatory, unhelpful, often wrong.
- "This violates DRY/YAGNI/SOLID." — principle-thumping. State the concrete cost instead.
- "Please refactor." — vague. Refactor *how*?
- "I don't like this." — preference dressed as review.

---

## Section 5: When NOT to flag

The witch-hunt is the failure mode opposite to the slop. Calibrate:

- **Humans also write defensive code.** A `null` check at a system boundary (API input, external response) is correct — don't flag it as paranoia.
- **One-line wrappers can earn their weight** when they name a domain concept. `function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6 }` is fine.
- **Try/catch around legacy code with unknown failure modes** is a reasonable hedge while the code is being understood.
- **Abstractions can be intentional** if the author knows the second implementation is coming in the next PR. Ask, don't assume.
- **Verbose error messages** are appropriate at log/user boundaries even when they feel chatty.
- **Repetitive code** is fine if the alternatives (abstraction, metaprogramming) cost more than the duplication. Rule of three.
- **Tests that look thin** may be intentional smoke tests for a path that's hard to exercise more deeply.
- **Magic numbers in tests** are often more readable than named constants. `expect(result).toEqual(42)` doesn't need `EXPECTED_MEANING_OF_LIFE`.

Rule of thumb: if you cannot articulate the **concrete cost** of the pattern in this specific codebase, do not flag it.

---

## Section 6: Stack-specific appendix

Concrete examples from common stacks. Use these as templates for finding language.

### 6.1 Go

- **Error wrapping**: `fmt.Errorf("doing X: %w", err)` — wrapping with `%w` preserves the chain. `fmt.Errorf("doing X: %v", err)` *loses* the chain. Flag the latter.
- **`if err != nil { return err }`** is canonical Go — do **not** flag it as defensive paranoia.
- **`interface{}` / `any` parameter** introduced where a concrete type would do — flag.
- **`for rows.Next()` loop missing `rows.Err()` check** — `database/sql` requires it. Bug, not slop.
- **goroutine launched without lifetime owner** (no `context`, no `wg`, no channel return) — leak risk.
- **Mutex by value embedded in a struct that gets copied** — silent data race.

### 6.2 React / TypeScript

- **`useEffect` with empty deps doing data fetch** — usually wants `useEffect` + `AbortController`, or better, the data-fetch lib already in the project (React Query, SWR, tRPC).
- **`useState` for derived state** that should be a memoized computation.
- **Inline anonymous functions in props** are usually fine — don't flag them as performance issues unless profiling shows otherwise.
- **`any` in component props** — flag. Components are the public contract of the UI layer.
- **New context provider for state that two siblings share** — premature; lift state to the parent or use the project's state lib.
- **Component file >200 lines** mixing data fetching, business logic, and rendering — split.

### 6.3 Tailwind / CSS

- **Arbitrary values everywhere** (`h-[473px]`, `text-[#3a5b71]`) — should use design tokens or the closest scale value.
- **`!important` (`!h-screen`)** introduced to override — almost always wrong; find the source of the cascade conflict.
- **`h-screen` on mobile-facing UI** — breaks on iOS Safari (chrome + virtual keyboard). Prefer `h-dvh` or `min-h-dvh`.
- **Fixed `grid-cols-N` without mobile breakpoint** — should be `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N`.
- **`<input>` / `<textarea>` with `text-sm` only** — font-size <16px triggers iOS Safari auto-zoom on focus. Use `text-base md:text-sm`.
- **Inline `style={{...}}` for things Tailwind covers** — should use a class.

### 6.4 SQL / migrations

- **String concatenation building SQL** with user input — injection. Always parameterize.
- **`SELECT *` in production queries** — fragile to schema change, fetches unused columns.
- **Migration that's not idempotent** — re-running it fails. Use `IF NOT EXISTS` / `IF EXISTS` where appropriate.
- **NOT NULL column added without DEFAULT or backfill** — breaks deployed code reading old rows.
- **Index added on a low-cardinality column** without justification — waste.
- **`ORDER BY` / `WHERE` on a column with no index** in a query expected to be hot — performance landmine.

---

## How to use this reference

1. Read the relevant section based on the slop signals from the inline SKILL.md checklist.
2. Match the pattern to a section here.
3. Use the **phrasing** guide (Section 4) to write the finding.
4. Apply the **severity rule** from SKILL.md: structural (§1, §3) → Important; micro (§2) → Suggestion.
5. If unsure whether to flag, re-read Section 5 ("When NOT to flag") first.

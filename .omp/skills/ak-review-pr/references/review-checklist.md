# Review checklist

**Correctness**
- Logic errors, off-by-one, nil/null dereference
- Missing error handling or swallowed errors
- Race conditions in concurrent code
- Edge cases not handled

**Security**
- Injection (SQL, XSS, command, SSRF, path traversal)
- Hardcoded secrets or credentials
- Missing input validation at system boundaries
- Authentication/authorization gaps

**Breaking changes**
- API contract changes (request/response shapes, status codes)
- Database schema changes without migrations
- Config format changes without backwards compatibility
- Removed or renamed exports/public interfaces

**Code quality (anti-slop — terse checklist)**
LLM-assisted PRs commonly introduce code that *runs fine* but pollutes the codebase. Scan the diff for these high-signal patterns:

- New file in dumping-ground dirs (`utils/`, `helpers/`, `lib/common/`, `*manager.ts`) without a clear domain anchor
- Parallel reimplementation of a utility that already exists in the repo (grep for prior art)
- New abstraction (interface + factory + builder) with only one caller — premature
- New config flag for behavior that should be hardcoded
- Defensive paranoia — try/catch around code that cannot throw; null checks on typed-non-null params
- Catch-and-swallow — `catch (e) { console.log(e) }` or `catch { return null }`
- Over-comment — comments paraphrasing code (`// increment counter` next to `counter++`)
- One-line wrappers that add indirection with no value
- Re-implementing stdlib (`chunk`, `range`, `groupBy`) when language or existing dep covers it
- `any` widening, `@ts-ignore`, `// eslint-disable` introduced to silence (not fix) warnings
- Phantom test coverage — tests that exercise lines without meaningful assertions
- Unused imports / exports / parameters / variables introduced
- File grows past the project's size limit (commonly 200 lines) without splitting
- Diff size doesn't match scope ("fix typo" with +800/−60)
- Touches files unrelated to stated purpose
- Commit messages with generic LLM phrasing ("improve code quality and enhance maintainability")

**Load the full taxonomy** in `references/anti-ai-slop.md` when ANY of:
- diff adds >300 lines, OR
- ≥2 inline anti-slop flags above fire, OR
- PR creates >2 new files in `utils/`/`helpers/`/`lib/common/`, OR
- you cannot confidently judge whether a pattern is genuine YAGNI vs slop

The reference covers: structural slop, micro slop, process slop, how to phrase the finding without becoming an AI-witch-hunt, when NOT to flag, and stack-specific appendix (Go, React/TS, Tailwind).

**Project-specific compliance**
- Read the project's loaded instruction surfaces and follow its documentation navigation to locate current architecture, coding, data, UI, and review standards
- Verify every cited rule against the current path, source, tests, or configuration that owns it
- Check the diff against project conventions for: architecture patterns, ID scoping, SQL store rules, i18n catalogs, UI/CSS conventions, package manager, file-size limits
- See `references/project-rules-example.md` for a worked example of project-specific compliance rules (Go gateway, React/Tailwind UI)

**Testing**
- Are new code paths covered by tests?
- Do existing tests still pass with these changes?
- Are edge cases tested?
- Watch for phantom coverage (assertions that always pass)

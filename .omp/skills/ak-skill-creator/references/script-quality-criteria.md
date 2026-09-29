# Script Quality Criteria

Scripts provide deterministic reliability and token efficiency.

## Dependency Strategy

Before bundling any external code with a skill, decide **where** the dep
should live: a central cache the runner already owns, or the skill directory.
The default is the central cache. See
[`./script-dependency-strategy.md`](./script-dependency-strategy.md) for the
decision tree, pinning rules, central-cache rationale, and the anti-patterns
this section shorthands to.

Rule of thumb: **declare deps at the invocation site** — pinned ephemeral
runner (`npx -y pkg@x.y.z`, `pipx run pkg==x.y.z`, `uvx --from 'pkg==x.y.z' cmd`)
or PEP 723 inline metadata + `uv run`. Reach for `requirements.txt` or
`package.json` only under the "Legit local-dep exceptions" cases in the
strategy ref (offline, native binaries, org vendoring policy).

## When to Include Scripts

- Same code rewritten repeatedly
- Deterministic operations needed
- Complex transformations
- External tool integrations

## Cross-Platform Requirements

**Prefer:** Node.js or Python
**Avoid:** Bash scripts (not well-supported on Windows)

If bash required, provide Node.js/Python alternative.

## Testing Requirements

**Mandatory:** All scripts must have tests

```bash
# Run tests before packaging
python -m pytest scripts/tests/
# or
npm test
```

Tests must pass. No skipping failed tests.

## Environment Variables

Respect hierarchy (first found wins):

1. `process.env` (runtime)
2. User skill `.env` (skill-specific)
3. Shared user skills `.env`
4. `$HOME/.claude/.env` (global)
5. Project skill `.env` (cwd)
6. Shared project skills `.env` (cwd)
7. `./.claude/.env` (cwd)

**Implementation pattern (Python).** `python-dotenv` is optional — treat it
as a soft dep so the script keeps working when the module is unavailable in
the user's runtime (which will be the common case once skills stop shipping
per-skill venvs). Fall back to `os.environ` (already populated by the shell
or the runtime) when import fails, and log the fallback so it stays
observable:

```python
import os, logging

try:
    from dotenv import load_dotenv
    for path in (
        os.path.expanduser('~/.claude/.env'),
        user_shared_skills_env,
        user_skill_env,
        project_skill_env,
        project_shared_skills_env,
        './.claude/.env',
    ):
        load_dotenv(path)
except ImportError:
    logging.warning(
        "python-dotenv not installed; relying on process env only. "
        "Run this script via `uv run --script` with python-dotenv declared "
        "in its PEP 723 metadata, or export the vars directly."
    )
# process.env / os.environ already takes precedence
```

`.env` files themselves are never shipped with a skill —
`scripts/package_skill.py` excludes them (see the packager's `EXCLUDE_GLOBS`).
Ship `.env.example` instead as a documentation template.

## Documentation Requirements

### .env.example
Show required variables without values:

```
API_KEY=
DATABASE_URL=
DEBUG=false
```

### requirements.txt (Python) — conditional
Ship a `requirements.txt` **only** when the "Legit local-dep exceptions" cases
in [`./script-dependency-strategy.md`](./script-dependency-strategy.md) apply
(offline user runtime, native/binary deps ephemeral runners handle poorly, org
vendoring policy). When you do ship one, pin exactly and keep it minimal
(≤2 deps):

```
requests==2.32.3
python-dotenv==1.0.1
```

For the default path (no exception), invoke tools via `pipx run pkg==x.y.z`
or `uvx --from 'pkg==x.y.z' cmd`, or declare deps inline via PEP 723 + `uv run`.

### package.json (Node.js) — conditional
Only ship a `package.json` under the same exception cases as `requirements.txt`.
Otherwise call the tool via `npx -y pkg@x.y.z` at the invocation site.
`node_modules/` is stripped by `scripts/package_skill.py` when packaging, so
any skill that expects its bundled `node_modules/` at the user's runtime is
broken by contract — declare deps at the invocation site instead. When a
`package.json` is warranted, include scripts:

```json
{
  "scripts": {
    "test": "jest"
  }
}
```

## Manual Testing

Before packaging, test with real use cases:

```bash
# Example: PDF rotation script
python scripts/rotate_pdf.py input.pdf 90 output.pdf # resource-link-example: illustrative script
```

Verify output matches expectations.

## Error Handling

- Clear error messages
- Graceful failures
- No silent errors
- Exit codes: 0 success, non-zero failure

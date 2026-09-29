# Script Dependency Strategy

How a skill declares external code without bloating disk. Guidance for skill
authors from version 4.1.0 onward — see the compatibility note at the end
for existing skills.

The one-line rule: **no per-skill copy of anything a central cache can own.
Declare deps at the invocation site — pinned runner command or PEP 723 inline
metadata — never as an installed footprint inside the skill directory.**

## 1. Decision Tree

Follow in order; drop out at the first match.

1. **Stdlib is enough.** Ship zero deps. Prefer `argparse`, `pathlib`, `json`,
   `subprocess`, `urllib.request` over reaching for a library.
2. **A maintained CLI exists.** Invoke via a pinned ephemeral runner:
   - Node: `npx -y pkg@1.2.3 …` or `pnpm dlx pkg@1.2.3 …`
   - Python: `pipx run pkg==1.2.3 …` or `uvx --from 'pkg==1.2.3' cmd …`
   Never re-wrap a CLI in your own script.
3. **Python library, no CLI.** Use PEP 723 inline metadata + `uv run`:
   ```python
   #!/usr/bin/env -S uv run --script
   # /// script
   # dependencies = ["httpx==0.27.0"]
   # ///
   import httpx
   ```
   `pipx run` also honors the inline block. Deps resolve into the central
   cache, not into a per-skill `.venv`.
4. **Node library, no CLI (weak spot).** Options in preference order:
   - Prefer a Python equivalent for that script.
   - Wrap the lib behind a maintained CLI you can `npx` instead.
   - Last resort: minimal `package.json` with a documented setup step;
     accept that `node_modules/` is stripped by `package_skill.py` and the
     end-user must run `npm ci` before invoking.
5. **Legit local-dep exceptions.** Documented setup is required in `SKILL.md`
   when any of these apply:
   - offline / air-gapped user environments,
   - native or binary deps that ephemeral runners handle poorly,
   - org policy mandates vendored, auditable installs.
   Keep it minimal (≤2 deps), pinned exactly, and never auto-install silently.

## 2. Pinning & Fail-Fast Rules

**Exact pins are mandatory.** Floating tags drift and open a typosquat /
hijack surface at the *user's* runtime, not yours.

| Runner | Correct | Wrong |
|--------|---------|-------|
| `npx` | `npx -y pkg@1.2.3` | `npx pkg`, `npx pkg@latest` |
| `pipx` | `pipx run pkg==1.2.3` | `pipx run pkg` |
| `uvx` | `uvx --from 'pkg==1.2.3' cmd` | `uvx cmd` |
| `pnpm` | `pnpm dlx pkg@1.2.3` | `pnpm dlx pkg` |

**Non-interactive by default.** `npx` without `-y` will hang forever waiting
for a "install this package? (y/n)" prompt in an agent context. Always pass
`-y`. `pipx run` and `uvx` are non-interactive by default.

**Fail-fast availability check.** The user machine may not have `uv`, `pipx`,
`bun`, or even a network. Detect early with an actionable message:

```python
import shutil, sys
if shutil.which("uv") is None:
    sys.exit("uv is required. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh")
```

**Network note in SKILL.md.** When a skill relies on ephemeral runners, add
one line to its `SKILL.md`: *"Requires network on first invocation to fetch
`<pkg>`; cached thereafter."*

**Pick one primary runner per ecosystem.** Not a fallback ladder — a single
runner. Suggested defaults:

- Node → `npx -y` (ships with Node; most universally available).
- Python → `uvx` primary, `pipx run` fallback.

## 3. Central-Cache Rationale

Ephemeral runners share their caches across every skill on the machine:

- **`npx`** stores packages in `~/.npm/_npx/` — each pinned version once,
  reused by any skill or project.
- **`uv`** keeps a hard-linked cache at `~/.cache/uv/`; ten skills asking for
  `httpx==0.27.0` cost one copy on disk.
- **`pipx`** creates one venv per tool under `~/.local/pipx/venvs/`, shared
  across projects.

Per-skill `node_modules/` or `.venv/` defeats all of this: N skills → N
copies, each hundreds of MB, none reusable.

**Packaging-contract argument (the strongest one).** `scripts/package_skill.py`
already strips `node_modules/` (and, from 4.1.0, `venv/` and `.venv/`). A
skill that expects its bundled `node_modules/` to be present at the user's
runtime is **broken by contract** — the zip never had them. Declaring deps
at the invocation site makes what was implicit explicit.

## 4. Eight Anti-Patterns

Each entry: **cause → fix.**

1. **Commit `node_modules/`, `.venv/`, `venv/`, vendored wheels/tarballs.**
   Bloat + broken-by-contract (venvs are non-relocatable). → Add to
   `.gitignore`; use a pinned runner or PEP 723 instead.
2. **Skill-local `requirements.txt` for a tool already exposed as a CLI.**
   Duplicates what `pipx run pkg==x.y.z` gives for free. → Drop the file;
   invoke the CLI directly.
3. **First-run bootstrap that runs `npm install` / `pip install` into the
   skill directory.** Silently mutates the skill's own tree. → Use a pinned
   ephemeral runner or PEP 723; keep the skill dir read-only.
4. **`pip install --user` or `npm install -g` from inside a script.** Mutates
   global env, causes cross-skill version conflicts, needs elevated perms on
   some systems. → Never mutate global env from a script; use ephemeral
   runners.
5. **Unpinned ephemeral invocation (`npx tool`, `pipx run pkg`, `@latest`).**
   Behavior drifts silently; supply-chain surface widens. → Pin every version
   exactly.
6. **Interactive runner in a non-interactive context (`npx` without `-y`).**
   Hangs the agent turn forever. → Always pass `-y` (or the runner's
   equivalent).
7. **Heavy library for a stdlib-sized job** (e.g. pandas to read one CSV,
   requests for one GET). → Use `csv`, `urllib.request`, `pathlib`.
8. **Re-implement in a bundled script something a maintained CLI already
   does.** Doubles the maintenance surface. → Invoke the CLI via `npx`/`uvx`.

## 5. Migration & Compatibility

**Additive, not breaking.** This guidance applies to skills authored from
`ak-skill-creator` version 4.1.0 onward. Skills that currently ship
`requirements.txt`, `package.json`, or a documented local setup remain
valid — no migration required, no scanner enforced, and `package_skill.py`
will keep packaging them exactly as before (minus the always-stripped
`node_modules/` and, from 4.1.0, `venv/`/`.venv/` and the newly-excluded
`.env`).

**Templates that were mandatory become conditional.** `requirements.txt` and
the `python-dotenv` recipe are exception paths from 4.1.0 — used only when
justified by one of the "Legit local-dep exceptions" cases in §1. Existing
skills that use them stay valid; new skills should route through the
decision tree first.

## Creator validation dependency

Skill metadata requires safe YAML parsing. The version is owned by
`scripts/requirements.txt` and the validator's PEP 723 header. Use
`uv run scripts/quick_validate.py <skill-dir>` and
`uv run --with PyYAML==6.0.3 scripts/package_skill.py <skill-dir> <out-dir>` from this skill root.
Existing managed environments can install the requirements and use Python directly.
Init, lint and eval helpers remain standard-library only. CI installs dependencies
in a disposable environment; no per-skill environment is bundled or persisted.

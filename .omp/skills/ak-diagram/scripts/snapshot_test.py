#!/usr/bin/env python3
"""ak:diagram snapshot test — verify golden PNGs match freshly-rendered output.

For each template variant, render → freeze → screenshot → byte-hash. Compare
against golden hash stored in references/snapshot-hashes.yaml. A verification
run refuses missing goldens; only --update-goldens may seed or refresh them.

Usage:
    python3 scripts/snapshot_test.py --all                    # every template
    python3 scripts/snapshot_test.py --type loop --variant light
    python3 scripts/snapshot_test.py --update-goldens         # record all
    python3 scripts/snapshot_test.py --all --json             # machine output
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover — yaml is in workspace root
    yaml = None

SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = SKILL_ROOT / "assets" / "templates"
HASHES_FILE = SKILL_ROOT / "references" / "snapshot-hashes.yaml"


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _python_for_render() -> str:
    """Prefer the shared skill venv python; fall back to sys.executable."""
    for candidate in [SKILL_ROOT.parents[i] for i in range(2, 6) if i < len(SKILL_ROOT.parents)]:
        py = candidate / ".claude" / "skills" / ".venv" / "bin" / "python3"
        if py.exists():
            return str(py)
        py_win = candidate / ".claude" / "skills" / ".venv" / "Scripts" / "python.exe"
        if py_win.exists():
            return str(py_win)
    env_hint = os.environ.get("AGENTKIT_HOME")
    if env_hint:
        py = Path(env_hint) / ".claude" / "skills" / ".venv" / "bin" / "python3"
        if py.exists():
            return str(py)
    return sys.executable


def _render_variant(dtype: str, variant: str, tmp: Path) -> Path:
    """Delegate to render.py for a single template variant."""
    import subprocess
    src = TEMPLATES_DIR / dtype / f"{variant}.html"
    if not src.exists():
        raise FileNotFoundError(src)
    subprocess.check_call([
        _python_for_render(),
        str(SKILL_ROOT / "scripts" / "render.py"),
        "--input", str(src),
        "--out", str(tmp),
        "--no-svg",
        "--snapshot-profile",
    ])
    return tmp / f"{variant}.png"


def _load_hashes() -> dict:
    if not HASHES_FILE.exists() or yaml is None:
        return {}
    return yaml.safe_load(HASHES_FILE.read_text(encoding="utf-8")) or {}


def _save_hashes(hashes: dict) -> None:
    if yaml is None:
        raise SystemExit("yaml module required — install pyyaml in shared venv")
    HASHES_FILE.parent.mkdir(parents=True, exist_ok=True)
    HASHES_FILE.write_text(
        "# ak:diagram golden PNG hashes — regenerate via snapshot_test.py --update-goldens\n"
        + yaml.safe_dump(hashes, sort_keys=True),
        encoding="utf-8",
    )


def _iter_templates(only_type: str | None, only_variant: str | None):
    for type_dir in sorted(TEMPLATES_DIR.iterdir()) if TEMPLATES_DIR.exists() else []:
        if not type_dir.is_dir():
            continue
        if only_type and type_dir.name != only_type:
            continue
        for html in sorted(type_dir.glob("*.html")):
            variant = html.stem
            if only_variant and variant != only_variant:
                continue
            yield type_dir.name, variant


def run(update_goldens: bool, only_type: str | None,
        only_variant: str | None) -> tuple[int, list[dict]]:
    goldens = _load_hashes()
    results: list[dict] = []
    exit_code = 0
    templates = list(_iter_templates(only_type, only_variant))
    discovered_keys = {f"{dtype}/{variant}" for dtype, variant in templates}
    expected_keys = {
        key for key in goldens
        if (only_type is None or key.startswith(f"{only_type}/"))
        and (only_variant is None or key.endswith(f"/{only_variant}"))
    }

    if not templates:
        results.append({"type": only_type or "all", "variant": only_variant or "all",
                        "status": "error", "detail": "no matching templates found"})
        return 2, results

    if not update_goldens:
        for key in sorted(expected_keys - discovered_keys):
            dtype, variant = key.split("/", 1)
            results.append({"type": dtype, "variant": variant,
                            "status": "missing-template"})
            exit_code = 1

    with tempfile.TemporaryDirectory(prefix="ak-diag-snap-") as tmp_root:
        for dtype, variant in templates:
            tmp = Path(tmp_root) / dtype
            try:
                png_path = _render_variant(dtype, variant, tmp)
            except Exception as exc:
                results.append({"type": dtype, "variant": variant, "status": "error", "detail": str(exc)})
                exit_code = 2
                continue

            actual = _hash_bytes(png_path.read_bytes())
            key = f"{dtype}/{variant}"
            expected = goldens.get(key)

            if update_goldens:
                goldens[key] = actual
                status = "recorded" if expected is None else "updated"
            elif expected is None:
                status = "missing"
                exit_code = 1
            elif actual == expected:
                status = "pass"
            else:
                status = "fail"
                exit_code = 1

            results.append({
                "type": dtype,
                "variant": variant,
                "status": status,
                "actual": actual[:12],
                "expected": (expected or "")[:12],
            })

    if update_goldens:
        _save_hashes(goldens)

    return exit_code, results


def main() -> int:
    parser = argparse.ArgumentParser(description="ak:diagram snapshot suite")
    parser.add_argument("--all", action="store_true", help="Test every template")
    parser.add_argument("--type", type=str, default=None, help="Filter to one type")
    parser.add_argument("--variant", type=str, default=None, help="Filter to one variant")
    parser.add_argument("--update-goldens", action="store_true", help="Record fresh goldens")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    if not (args.all or args.type or args.update_goldens):
        parser.error("pass --all, --type, or --update-goldens")

    code, results = run(args.update_goldens, args.type, args.variant)

    if args.json:
        print(json.dumps({"exit": code, "results": results}, indent=2))
    else:
        pass_count = sum(1 for r in results if r["status"] == "pass")
        fail_count = sum(1 for r in results if r["status"] == "fail")
        missing_count = sum(1 for r in results if r["status"] == "missing")
        missing_template_count = sum(1 for r in results if r["status"] == "missing-template")
        error_count = sum(1 for r in results if r["status"] == "error")
        rec_count = sum(1 for r in results if r["status"] in ("recorded", "updated"))
        print(f"snapshot: pass={pass_count} fail={fail_count} missing={missing_count} missing-template={missing_template_count} error={error_count} recorded={rec_count}")
        for r in results:
            if r["status"] in ("fail", "missing", "missing-template", "error"):
                print(f"  {r['status'].upper():8s} {r['type']}/{r['variant']}  {r.get('detail','')}")

    return code


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""ak:diagram vendor — copy editorial templates from cathrynlavery/diagram-design (MIT).

Reads a shallow-cloned upstream checkout, filters to selected diagram types,
strips CDN references, wraps each HTML in a lightweight metadata frontmatter
comment, and writes to assets/templates/<type>/<variant>.html.

Also emits references/vendoring-metadata.yaml with upstream SHA + license + timestamps
so re-vendoring is idempotent and provenance is auditable.

Usage:
    # Clone upstream once, then vendor
    git clone --depth 1 https://github.com/cathrynlavery/diagram-design.git /tmp/dd-src
    python3 scripts/vendor_from_upstream.py --source /tmp/dd-src

    # Dry run — show what would change
    python3 scripts/vendor_from_upstream.py --source /tmp/dd-src --dry-run

    # Restrict to specific types (default: all base 24)
    python3 scripts/vendor_from_upstream.py --source /tmp/dd-src --types architecture,loop,pyramid
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = SKILL_ROOT / "assets" / "templates"
METADATA_FILE = SKILL_ROOT / "references" / "vendoring-metadata.yaml"

# 24 base types across 4 clusters (locked in advise 260816-0715).
DEFAULT_TYPES = [
    # Architecture cluster (7)
    "architecture", "high-level", "layers", "medallion",
    "dp-integration", "dp-security-matrix", "data-flow",
    # Flow & process cluster (6)
    "flowchart", "sequence", "state", "swimlane", "process", "org-chart",
    # Storytelling cluster (7)
    "loop", "pyramid", "quadrant", "radar", "timeline", "nested", "it-state",
    # Data viz cluster (4)
    "bar", "line", "scatter", "gantt",
]

VARIANTS = {
    "light": "",           # example-<type>.html
    "dark": "-dark",       # example-<type>-dark.html
    "full": "-full",       # example-<type>-full.html
}

# Strip patterns — CDN scripts and analytics that break determinism
STRIP_PATTERNS = [
    re.compile(r'<script[^>]+src="https://[^"]+"[^>]*></script>', re.IGNORECASE),
    re.compile(r'<link[^>]+href="https://fonts\.[^"]+"[^>]*>', re.IGNORECASE),
    re.compile(r'<script[^>]+src="https://www\.googletagmanager[^"]+"[^>]*></script>', re.IGNORECASE),
]


def _read_upstream_sha(source: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "HEAD"],
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def _sanitize(html: str) -> str:
    out = html
    for pattern in STRIP_PATTERNS:
        out = pattern.sub("", out)
    return out


def _wrap_with_metadata(html: str, source_rel: str, upstream_sha: str) -> str:
    header = (
        f"<!--\n"
        f"  ak:diagram vendored template\n"
        f"  upstream: cathrynlavery/diagram-design (MIT)\n"
        f"  source_path: skills/diagram-design/assets/{source_rel}\n"
        f"  upstream_sha: {upstream_sha}\n"
        f"  imported_at: {datetime.now(timezone.utc).isoformat()}\n"
        f"  license: MIT (see references/vendoring-metadata.yaml)\n"
        f"-->\n"
    )
    return header + html


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def vendor(
    source: Path,
    types: list[str],
    dry_run: bool = False,
) -> dict:
    upstream_assets = source / "skills" / "diagram-design" / "assets"
    if not upstream_assets.is_dir():
        raise SystemExit(f"upstream assets not found: {upstream_assets}")

    upstream_sha = _read_upstream_sha(source)
    stats = {"created": 0, "updated": 0, "skipped": 0, "missing": []}
    manifest = []

    for dtype in types:
        target_dir = TEMPLATES_DIR / dtype
        if not dry_run:
            target_dir.mkdir(parents=True, exist_ok=True)

        for variant, suffix in VARIANTS.items():
            source_name = f"example-{dtype}{suffix}.html"
            source_path = upstream_assets / source_name
            if not source_path.exists():
                stats["missing"].append(f"{dtype}/{variant}")
                continue

            raw = source_path.read_text(encoding="utf-8")
            sanitized = _sanitize(raw)
            wrapped = _wrap_with_metadata(sanitized, source_name, upstream_sha)

            target = target_dir / f"{variant}.html"
            existed = target.exists()
            if existed and target.read_text(encoding="utf-8") == wrapped:
                stats["skipped"] += 1
            elif dry_run:
                stats["updated" if existed else "created"] += 1
            else:
                target.write_text(wrapped, encoding="utf-8")
                stats["updated" if existed else "created"] += 1

            manifest.append({
                "type": dtype,
                "variant": variant,
                "source": source_name,
                "target": str(target.relative_to(SKILL_ROOT)),
                "sha256_12": _digest(wrapped),
            })

    if not dry_run:
        _write_metadata(manifest, upstream_sha, stats)

    return stats


def _write_metadata(manifest: list[dict], upstream_sha: str, stats: dict) -> None:
    METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# ak:diagram vendoring metadata — do not edit by hand.",
        "# Regenerated by scripts/vendor_from_upstream.py.",
        f"upstream_repo: cathrynlavery/diagram-design",
        f"upstream_license: MIT",
        f"upstream_sha: {upstream_sha}",
        f"vendored_at: {datetime.now(timezone.utc).isoformat()}",
        f"template_count: {len(manifest)}",
        "templates:",
    ]
    for entry in manifest:
        lines.append(
            f"  - type: {entry['type']}\n"
            f"    variant: {entry['variant']}\n"
            f"    source: {entry['source']}\n"
            f"    target: {entry['target']}\n"
            f"    sha256_12: {entry['sha256_12']}"
        )
    METADATA_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Vendor templates from diagram-design upstream")
    parser.add_argument("--source", type=Path, required=True, help="Path to cloned upstream repo")
    parser.add_argument(
        "--types",
        type=str,
        default=",".join(DEFAULT_TYPES),
        help="Comma-separated diagram type slugs (default: 24 locked)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report without writing")
    args = parser.parse_args()

    types = [t.strip() for t in args.types.split(",") if t.strip()]
    stats = vendor(args.source, types, dry_run=args.dry_run)

    print(f"vendor: created={stats['created']} updated={stats['updated']} skipped={stats['skipped']}")
    if stats["missing"]:
        print(f"missing upstream variants ({len(stats['missing'])}):")
        for m in stats["missing"]:
            print(f"  - {m}")
    if args.dry_run:
        print("(dry run — no files written)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

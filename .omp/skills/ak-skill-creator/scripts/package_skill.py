#!/usr/bin/env python3
"""
Skill Packager - Creates a distributable zip file of a skill folder

Usage:
    python utils/package_skill.py <path/to/skill-folder> [output-directory]

Example:
    python utils/package_skill.py skills/public/my-skill
    python utils/package_skill.py skills/public/my-skill ./dist
"""

import fnmatch
import sys
import zipfile
from pathlib import Path

from encoding_utils import configure_utf8_console
from frontmatter_validation import MissingDependencyError
from quick_validate import validate_skill

# Fix Windows console encoding for Unicode output (emojis, arrows)
configure_utf8_console()

# Exclusion patterns (from official Anthropic skill-creator).
# `venv` / `.venv` mirror the existing `node_modules` policy: bundled runtime
# dirs are stripped so packaged skills do not ship per-skill footprints.
# `.env` is excluded to prevent secret leaks; ship `.env.example` instead.
# NOTE: `.env` is an EXACT-MATCH glob — do NOT change to `.env*` or `.env.*`
# or `.env.example` templates will be silently stripped from packaged skills.
EXCLUDE_DIRS = {'__pycache__', 'node_modules', '.git', '.DS_Store',
                'venv', '.venv'}
EXCLUDE_GLOBS = {'*.pyc', '*.pyo', '.DS_Store', '*.egg-info', '.env'}
ROOT_EXCLUDE_DIRS = {'evals'}  # Only excluded at skill root level
_ADVISORY_MARKERS = {'node_modules', 'venv', '.venv'}


def package_skill(skill_path, output_dir=None):
    """
    Package a skill folder into a zip file.

    Args:
        skill_path: Path to the skill folder
        output_dir: Optional output directory for the zip file (defaults to current directory)

    Returns:
        Path to the created zip file, or None if error
    """
    skill_path = Path(skill_path).resolve()

    # Validate skill folder exists
    if not skill_path.exists():
        print(f"❌ Error: Skill folder not found: {skill_path}")
        return None

    if not skill_path.is_dir():
        print(f"❌ Error: Path is not a directory: {skill_path}")
        return None

    # Validate SKILL.md exists
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print(f"❌ Error: SKILL.md not found in {skill_path}")
        return None

    # Run validation before packaging
    print("🔍 Validating skill...")
    try:
        valid, message = validate_skill(skill_path)
    except MissingDependencyError as exc:
        # An environment fault, not a skill-content finding: the skill may be
        # entirely valid, so this must never read as "Validation failed".
        print(f"❌ {exc}")
        return None
    if not valid:
        print(f"❌ Validation failed: {message}")
        print("   Please fix the validation errors before packaging.")
        return None
    print(f"✅ {message}\n")

    # Determine output location
    skill_name = skill_path.name
    if output_dir:
        output_path = Path(output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        output_path = Path.cwd()

    zip_filename = output_path / f"{skill_name}.zip"

    # Create the zip file
    try:
        with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Walk through the skill directory, excluding unwanted files
            skipped = []
            for file_path in skill_path.rglob('*'):
                if file_path.is_file():
                    rel = file_path.relative_to(skill_path)
                    parts = rel.parts

                    # Skip excluded directories
                    if any(p in EXCLUDE_DIRS for p in parts):
                        skipped.append(str(rel))
                        continue

                    # Skip root-only excluded dirs (e.g., evals/)
                    if parts[0] in ROOT_EXCLUDE_DIRS:
                        skipped.append(str(rel))
                        continue

                    # Skip excluded file patterns
                    if any(fnmatch.fnmatch(file_path.name, g) for g in EXCLUDE_GLOBS):
                        skipped.append(str(rel))
                        continue

                    arcname = file_path.relative_to(skill_path.parent)
                    zipf.write(file_path, arcname)
                    print(f"  Added: {arcname}")

            if skipped:
                print(f"\n  Skipped {len(skipped)} file(s): {', '.join(skipped[:5])}"
                      + ("..." if len(skipped) > 5 else ""))
                if any(
                    marker in Path(s).parts
                    for s in skipped
                    for marker in _ADVISORY_MARKERS
                ):
                    print(
                        "\n⚠️  Detected bundled runtime dirs (node_modules/venv/.venv). "
                        "These are stripped from the package. Prefer central-cache "
                        "runners (npx -y, pipx run, uvx) or PEP 723 + `uv run`. "
                        "See references/script-dependency-strategy.md."
                    )

        print(f"\n✅ Successfully packaged skill to: {zip_filename}")
        return zip_filename

    except Exception as e:
        print(f"❌ Error creating zip file: {e}")
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python utils/package_skill.py <path/to/skill-folder> [output-directory]")
        print("\nExample:")
        print("  python utils/package_skill.py skills/public/my-skill")
        print("  python utils/package_skill.py skills/public/my-skill ./dist")
        sys.exit(1)

    skill_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"📦 Packaging skill: {skill_path}")
    if output_dir:
        print(f"   Output directory: {output_dir}")
    print()

    result = package_skill(skill_path, output_dir)

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Create a new skill directory with a short SKILL.md skeleton.

Usage:
    python3 init_skill.py <skill-name> --path <parent-dir> [--description TEXT]
    python3 init_skill.py <slug> --path kits/<kit>/skills --kit <kit> [--description TEXT]

Without --kit the skill is a project or user skill: directory <slug>/ and a
minimal frontmatter. With --kit the skill is an AgentKit kit skill: directory
ak-<slug>/, name ak:<slug>, and the frontmatter fields the ak runtime reads
(see references/agentkit-kit-skill-contract.md). No example files are
written; add references/, scripts/, or assets/ when the skill needs them.
"""

import argparse
import json
import sys
from pathlib import Path

from encoding_utils import configure_utf8_console, write_text_utf8
from quick_validate import parse_identifier

configure_utf8_console()

KIT_NAMESPACE = 'ak'

PLAIN_FRONTMATTER = '''---
name: {full_name}
description: {description}
---
'''

KIT_FRONTMATTER = '''---
name: {full_name}
description: {description}
user-invocable: true
when_to_use: "Use when [precise activation condition]."
category: utilities
keywords: [{keyword}]
argument-hint: "[task or path] [--flag]"
metadata:
  author: agentkit
  version: "0.1.0"
---
'''

BODY = '''
<!-- skill-template: incomplete -->
# {title}

[Two or three sentences: what this skill produces, for whom, and the quality
bar. Name the environment or product context only the author knows.]

## When to use

- [Trigger situation the user would describe in their own words]
- Not for: [adjacent work and the skill that owns it]

## How to work

[State the outcome, constraints, authority and observable completion criteria.
For multiple workflows, route to references only when their branch applies.
Number steps when order encodes dependencies or prevents errors. Retain useful
examples; choose verification by changed behavior and explain real constraints.]

## Resources

- [`references/<name>.md`: when to open it]
- [`scripts/<name>.py`: what it does and the exact invocation]
'''


def title_case(slug):
    return ' '.join(word.capitalize() for word in slug.split('-'))


def sanitize_description(description):
    """Flatten a description into one double-quotable YAML scalar."""
    return json.dumps(' '.join(description.split()), ensure_ascii=False)


def build_skill_md(full_name, slug, description, kit):
    frontmatter = KIT_FRONTMATTER if kit else PLAIN_FRONTMATTER
    return frontmatter.format(
        full_name=full_name,
        description=sanitize_description(description),
        keyword=slug.split('-')[0],
    ) + BODY.format(title=title_case(slug))


def init_skill(identifier, parent, kit=None, description=None):
    """Create <parent>/<dir>/SKILL.md and return the skill directory path."""
    full_name, namespace, slug = parse_identifier(identifier)
    if kit:
        if namespace not in (None, KIT_NAMESPACE):
            raise ValueError(f"Kit skills use the '{KIT_NAMESPACE}:' namespace; got '{namespace}:'.")
        namespace = KIT_NAMESPACE
        full_name = f'{KIT_NAMESPACE}:{slug}'
        directory = Path(parent) / f'{KIT_NAMESPACE}-{slug}'
    else:
        directory = Path(parent) / slug

    if directory.exists():
        raise FileExistsError(f'{directory} already exists; update it instead of re-initializing.')

    if not description:
        description = f'[What {title_case(slug)} does]. Use when [trigger contexts]. Not for [adjacent work].'

    directory.mkdir(parents=True)
    write_text_utf8(directory / 'SKILL.md', build_skill_md(full_name, slug, description, bool(kit)))
    return directory


def main(argv=None):
    parser = argparse.ArgumentParser(description='Initialize a new skill directory.')
    parser.add_argument('skill_name', help="'skill-name' or 'namespace:skill-name'")
    parser.add_argument('--path', required=True, help='Parent directory that will contain the skill directory')
    parser.add_argument('--kit', help='AgentKit kit name; emits ak:<slug> frontmatter and an ak-<slug>/ directory')
    parser.add_argument('--description', help='Initial description text (edit it before validating)')
    args = parser.parse_args(argv)

    try:
        directory = init_skill(args.skill_name, args.path, kit=args.kit, description=args.description)
    except (ValueError, FileExistsError) as exc:
        print(f'Error: {exc}')
        return 1

    print(f'Created {directory / "SKILL.md"}')
    print('Next:')
    print('  1. Replace every bracketed placeholder and remove the skill-template marker.')
    print('  2. Add references/, scripts/ (with scripts/tests/), or assets/ only when the skill needs them.')
    print(f'  3. Run: uv run scripts/quick_validate.py {directory}')
    print(f'  4. Run: uv run --with PyYAML==6.0.3 scripts/lint_cruft.py {directory} --routing')
    if args.kit:
        print(f'  5. Register the skill in kits/{args.kit}/kit.yaml and run: cd apps/cli && go run . kit validate ../../kits/')
    return 0


if __name__ == '__main__':
    sys.exit(main())

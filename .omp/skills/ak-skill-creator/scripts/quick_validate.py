#!/usr/bin/env python3
# /// script
# dependencies = ["PyYAML==6.0.3"]
# ///
"""Structural validation for a skill directory.

Checks frontmatter (name, description, block scalars), size limits, broken
links to bundled resources, leftover template files, and, for kit skills,
literal native tool names that the AgentKit capability lint rejects.

Usage:
    python3 quick_validate.py <skill-dir> [--json] [--kit]

Exit code 0 when there are no errors. Warnings never fail the run.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from encoding_utils import configure_utf8_console, read_text_utf8
from frontmatter_validation import MissingDependencyError, parse_frontmatter, metadata_errors
from resource_validation import contained_file, validate_resources

configure_utf8_console()

MAX_SEGMENT_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_MARKDOWN_LINES = 300
ID_PATTERN = re.compile(r'^[a-z0-9-]+$')
BLOCK_SCALAR_INDICATORS = {'>', '>-', '>+', '|', '|-', '|+'}
LEFTOVER_TEMPLATE_FILES = (
    'scripts/example.py',
    'scripts/example_script.py',
    'references/api_reference.md',
    'references/example_reference.md',
    'assets/example_asset.txt',
)

# Native tool names the AgentKit kit capability lint rejects, and the
# portable capability to write instead. Mirrors skill_capability_lint.go.
NATIVE_TOOL_CAPABILITIES = {
    'AskUserQuestion': 'ask_user',
    'WebSearch': 'web_search',
    'WebFetch': 'web_search',
    'Task': 'delegate_agent',
    'TodoWrite': 'manage_plan',
    'TaskCreate': 'manage_plan',
    'TaskGet': 'manage_plan',
    'TaskUpdate': 'manage_plan',
    'TaskList': 'manage_plan',
    'Edit': 'edit_file',
    'Write': 'edit_file',
    'Read': 'read_file',
    'Grep': 'search_files',
    'Glob': 'search_files',
    'Bash': 'run_shell',
}
CAPABILITY_ALLOW_MARKER = 'capability-lint-allow:'


def _native_tool_pattern(name):
    quoted = re.escape(name)
    return re.compile(
        r'(?:`' + quoted + r'`|'
        r'\bUse\s+`?' + quoted + r'`?\s+tool\b|'
        r'\bvia\s+`?' + quoted + r'`?\b|'
        r'\b' + quoted + r'\s*\()'
    )


NATIVE_TOOL_PATTERNS = {
    name: _native_tool_pattern(name) for name in NATIVE_TOOL_CAPABILITIES
}


def parse_identifier(value):
    """Validate a skill identifier and return (full_name, namespace, slug).

    Accepts ``skill-name`` or ``namespace:skill-name`` with a single colon.
    Raises ValueError with a user-facing message when invalid.
    """
    value = value.strip().strip('"').strip("'")
    if value.count(':') > 1:
        raise ValueError(
            "Skill name must contain at most one colon: use 'skill-name' or "
            "'namespace:skill-name'."
        )
    namespace = None
    slug = value
    if ':' in value:
        namespace, slug = value.split(':', 1)
    for label, segment in (('Namespace', namespace), ('Skill id', slug)):
        if segment is None:
            continue
        if not ID_PATTERN.match(segment):
            raise ValueError(
                f"{label} '{segment}' must be lowercase letters, digits, and hyphens only."
            )
        if segment.startswith('-') or segment.endswith('-') or '--' in segment:
            raise ValueError(
                f"{label} '{segment}' cannot start/end with a hyphen or contain '--'."
            )
        if len(segment) > MAX_SEGMENT_LENGTH:
            raise ValueError(
                f"{label} '{segment}' exceeds {MAX_SEGMENT_LENGTH} characters ({len(segment)})."
            )
    full_name = f'{namespace}:{slug}' if namespace else slug
    return full_name, namespace, slug


def split_frontmatter(content):
    """Return (frontmatter_text, body_text) or (None, content) when absent."""
    if not content.startswith('---'):
        return None, content
    match = re.match(r'^---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)', content, re.DOTALL)
    if not match:
        return None, content
    return match.group(1), content[match.end():]


def read_scalar(frontmatter, key):
    """Read a top-level scalar from frontmatter text, folding block scalars.

    Returns None when the key is absent. Handles plain, quoted, folded (``>``)
    and literal (``|``) scalars well enough for description-length checks.
    """
    value = parse_frontmatter(frontmatter).get(key)
    return value.rstrip('\n') if isinstance(value, str) else value


def _markdown_files(skill_path):
    """Yield (path, allows_native_host_config) for every linted markdown file.

    The Go lint walks any `references` segment at any depth, and exempts the
    `allowed-tools:` frontmatter block in SKILL.md only, so mirror both.
    """
    yield skill_path / 'SKILL.md', True
    references = skill_path / 'references'
    if references.is_dir():
        for markdown in sorted(references.rglob('*.md')):
            yield markdown, False


def _is_top_level_yaml_key(line):
    """True when the line starts a top-level YAML key rather than continuing one."""
    if not line or line[0].isspace():
        return False
    stripped = line.strip()
    # An unindented block-sequence entry belongs to the key above it, so it must
    # not end the block the caller is tracking.
    if stripped.startswith('-'):
        return False
    key, separator, _rest = stripped.partition(':')
    return bool(separator) and bool(key)


def validate_skill_detailed(skill_path, kit=None):
    """Run every check and return a result dict.

    ``kit`` is None (auto-detect from the path), True, or False. When the
    skill sits under a ``kits/`` directory the kit checks run automatically.
    """
    skill_path = Path(skill_path)
    errors = []
    warnings = []
    result = {'path': str(skill_path), 'errors': errors, 'warnings': warnings}

    def error(file, line, message):
        errors.append({'file': file, 'line': line, 'message': message})

    def warn(file, line, message):
        warnings.append({'file': file, 'line': line, 'message': message})

    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        error('SKILL.md', 0, 'SKILL.md not found')
        return result

    if kit is None:
        kit = 'kits' in skill_path.resolve().parts
    result['kit'] = bool(kit)

    if not contained_file(skill_md, skill_path):
        error('SKILL.md', 0, 'SKILL.md resolves outside the skill directory')
        return result

    content = read_text_utf8(skill_md)
    frontmatter, body = split_frontmatter(content)
    if frontmatter is None:
        error('SKILL.md', 1, 'No YAML frontmatter found (expected a --- block at the top)')
        return result

    try:
        data = parse_frontmatter(frontmatter)
    except ValueError as exc:
        error('SKILL.md', 1, str(exc))
        return result
    for message in metadata_errors(data):
        error('SKILL.md', 1, message)
    if errors:
        return result

    name = data['name']
    if name is None or name == '':
        error('SKILL.md', 1, "Missing 'name' in frontmatter")
    else:
        try:
            _, namespace, slug = parse_identifier(name)
        except ValueError as exc:
            error('SKILL.md', 1, str(exc))
        else:
            expected_dir = f'{namespace}-{slug}' if kit and namespace else slug
            if kit and skill_path.resolve().name != expected_dir:
                warn('SKILL.md', 1, f"Directory '{skill_path.resolve().name}' does not match name '{name}' (expected '{expected_dir}')")
            if kit and namespace != 'ak':
                warn('SKILL.md', 1, f"Kit skills use the 'ak:' namespace; found '{name}'")

    description = data['description']
    if description is None or description == '':
        error('SKILL.md', 1, "Missing 'description' in frontmatter")
    else:
        if '<' in description or '>' in description:
            error('SKILL.md', 1, 'Description cannot contain angle brackets (< or >)')
        length = len(description)
        if length > MAX_DESCRIPTION_LENGTH:
            error('SKILL.md', 1, f'Description exceeds {MAX_DESCRIPTION_LENGTH} characters ({length})')

    if kit and data.get('when_to_use') in (None, ''):
        warn('SKILL.md', 1, "Kit skills should set 'when_to_use' for the routing catalog")

    for markdown, _ in _markdown_files(skill_path):
        rel = markdown.relative_to(skill_path).as_posix()
        if not contained_file(markdown, skill_path):
            continue
        text = content if markdown == skill_md else read_text_utf8(markdown)
        line_count = text.count('\n') + (0 if text.endswith('\n') or text == '' else 1)
        if line_count > MAX_MARKDOWN_LINES:
            # A warning, not an error: `ak kit validate` does not enforce a line
            # limit and dozens of shipped skills exceed this one, so failing on
            # it would make the check unachievable on the tree it ships in.
            warn(rel, line_count, f'{rel} has {line_count} lines; {MAX_MARKDOWN_LINES} keeps it loadable')

    validate_resources(skill_path, list(_markdown_files(skill_path)), error, warn)

    for leftover in LEFTOVER_TEMPLATE_FILES:
        if (skill_path / leftover).exists():
            warn(leftover, 0, f'Leftover template file {leftover}; delete or replace it')

    if kit:
        for markdown, allows_native_host_config in _markdown_files(skill_path):
            rel = markdown.relative_to(skill_path).as_posix()
            if not contained_file(markdown, skill_path):
                continue
            text = content if markdown == skill_md else read_text_utf8(markdown)
            in_frontmatter = False
            in_allowed_tools = False
            allow_next_line = False
            for number, line in enumerate(text.splitlines(), start=1):
                stripped = line.strip()
                if number == 1 and stripped == '---':
                    in_frontmatter = True
                    continue
                if in_frontmatter and stripped == '---':
                    in_frontmatter = False
                    in_allowed_tools = False
                    continue
                if in_frontmatter and _is_top_level_yaml_key(line):
                    in_allowed_tools = stripped.startswith('allowed-tools:')
                if allows_native_host_config and in_frontmatter and in_allowed_tools:
                    # allowed-tools is native host configuration, not prose that
                    # tells the model which tool to reach for.
                    continue
                if CAPABILITY_ALLOW_MARKER in line:
                    matched = [
                        tool for tool, pattern in NATIVE_TOOL_PATTERNS.items()
                        if pattern.search(line)
                    ]
                    # A marker on its own line exempts the line that follows; a
                    # marker trailing a tool name exempts only its own line.
                    allow_next_line = not matched
                    continue
                if allow_next_line:
                    allow_next_line = False
                    continue
                for tool, pattern in NATIVE_TOOL_PATTERNS.items():
                    if pattern.search(line):
                        capability = NATIVE_TOOL_CAPABILITIES[tool]
                        error(rel, number, f"Native tool name '{tool}' fails kit capability lint; write '{capability} capability' or add '{CAPABILITY_ALLOW_MARKER}'")

    return result


def validate_skill(skill_path, kit=None):
    """Compatibility wrapper returning (is_valid, message)."""
    result = validate_skill_detailed(skill_path, kit=kit)
    if result['errors']:
        first = result['errors'][0]
        suffix = '' if len(result['errors']) == 1 else f' (+{len(result["errors"]) - 1} more)'
        return False, f"{first['file']}:{first['line']}: {first['message']}{suffix}"
    if result['warnings']:
        return True, f"Skill is valid with {len(result['warnings'])} warning(s)"
    return True, 'Skill is valid!'


def _format_text(result):
    lines = []
    for item in result['errors']:
        lines.append(f"ERROR   {item['file']}:{item['line']}: {item['message']}")
    for item in result['warnings']:
        lines.append(f"WARNING {item['file']}:{item['line']}: {item['message']}")
    if not lines:
        lines.append('Skill is valid!')
    else:
        lines.append(f"{len(result['errors'])} error(s), {len(result['warnings'])} warning(s)")
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Validate a skill directory.')
    parser.add_argument('skill_dir', help='Path to the skill directory (contains SKILL.md)')
    parser.add_argument('--json', action='store_true', help='Emit a JSON report')
    parser.add_argument('--kit', dest='kit', action='store_true', default=None,
                        help='Force kit-skill checks (auto-detected under kits/)')
    parser.add_argument('--no-kit', dest='kit', action='store_false',
                        help='Disable kit-skill checks')
    args = parser.parse_args(argv)

    try:
        result = validate_skill_detailed(args.skill_dir, kit=args.kit)
    except MissingDependencyError as exc:
        # An environment fault, not a skill-content finding: report it on
        # stderr with a distinct exit code so it is never read as "this skill
        # is invalid" by a caller that only checks for a non-zero exit.
        print(str(exc), file=sys.stderr)
        return 3
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(_format_text(result))
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    sys.exit(main())

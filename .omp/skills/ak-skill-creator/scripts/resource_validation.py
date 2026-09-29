"""Check authored resources, including commands, with explicit example exemptions."""

import re
from pathlib import Path
from urllib.parse import unquote

TEMPLATE_MARKER = '<!-- skill-template: incomplete -->'
LEGACY_PLACEHOLDERS = (
    '[Two or three sentences: what this skill produces',
    '[State the outcome, the constraints, and how to verify the result.',
    '[Trigger situation the user would describe in their own words]',
)


def contained_file(path, root):
    """Check containment before reading bytes; broken and escaping links are errors."""
    try:
        path.resolve(strict=True).relative_to(root.resolve())
        return path.is_file()
    except (OSError, RuntimeError, ValueError):
        return False


def _kits_root(skill_path):
    """Return the repo's kits/ directory when skill_path is kits/<kit>/skills/<name>.

    Returns None outside that layout so the exemption below never fires for
    project skills, temp-dir fixtures, or any other directory shape.
    """
    resolved = skill_path.resolve()
    skills_dir = resolved.parent
    kits_dir = skills_dir.parent.parent
    if skills_dir.name == 'skills' and kits_dir.name == 'kits':
        return kits_dir
    return None


def _resolves_in_sibling_skill_or_docs(path, skill_path):
    """True when path is a real file under a sibling kit skill or the repo docs/ tree.

    Skills legitimately cross-link to sibling skills (``kits/*/skills/*``) and
    to ``docs/`` via relative paths; that is an established pattern, not a
    broken link. The target must still exist to be exempted, so a genuinely
    broken or out-of-repo link is still reported as an error.
    """
    kits_dir = _kits_root(skill_path)
    if kits_dir is None:
        return False
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        return False
    if not resolved.is_file():
        return False
    try:
        parts = resolved.relative_to(kits_dir).parts
    except ValueError:
        parts = ()
    if len(parts) >= 3 and parts[1] == 'skills':
        return True
    docs_dir = kits_dir.parent / 'docs'
    try:
        resolved.relative_to(docs_dir.resolve())
        return True
    except (OSError, RuntimeError, ValueError):
        return False


def resource_targets(text):
    bundled = re.compile(r'(?<![\w./-])((?:references|scripts|assets)/[\w./-]+)')
    markdown = re.compile(r'\[[^\]]*\]\(([^)]+)\)')
    for number, line in enumerate(text.splitlines(), 1):
        if 'resource-link-example:' in line:
            continue
        targets = {(match.group(1).rstrip('.,:;)'), True) for match in bundled.finditer(line)}
        for match in markdown.finditer(line):
            target = unquote(match.group(1).split('#', 1)[0].strip('<>'))
            if target and not re.match(r'^[a-zA-Z][\w+.-]*:', target) and not target.startswith('/'):
                targets.add((target, target.startswith(('references/', 'scripts/', 'assets/'))))
        for target, root_relative in sorted(targets):
            if any(char in target for char in '<>{}*') or '.' not in Path(target).name:
                continue
            yield number, target, root_relative


def validate_resources(skill_path, markdown_files, error, warn):
    for markdown, _ in markdown_files:
        rel = markdown.relative_to(skill_path).as_posix()
        if not contained_file(markdown, skill_path):
            error(rel, 0, 'Resource is missing or resolves outside the skill directory')
            continue
        text = markdown.read_text(encoding='utf-8')
        if markdown.name == 'SKILL.md':
            for number, line in enumerate(text.splitlines(), 1):
                if TEMPLATE_MARKER in line or any(token in line for token in LEGACY_PLACEHOLDERS):
                    error(rel, number, 'Unfinished initializer placeholder; finish the skill and remove its template marker')
        for number, target, root_relative in resource_targets(text):
            candidate = (skill_path if root_relative else markdown.parent) / target
            if contained_file(candidate, skill_path):
                continue
            if _resolves_in_sibling_skill_or_docs(candidate, skill_path):
                continue
            report = warn if target.startswith('assets/') else error
            report(rel, number, f"Link target '{target}' is missing or outside the skill directory")

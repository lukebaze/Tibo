"""Narrow routing advisories on decoded YAML, separate from body pressure rules.

These patterns identify review candidates, not routing quality or semantic
contradictions. Actual activation still needs model evaluation in its catalog.
"""

import re

from frontmatter_validation import parse_frontmatter


ROUTING_PRESSURE = re.compile(
    r'^(?:you (?:must|should) )?(?:always (?:use|invoke|activate) (?:this|the) skill'
    r'|never skip (?:this|the) skill'
    r'|(?:use|invoke|activate) (?:this|the) skill (?:for|on) (?:every|any|all) '
    r'(?:tasks?|requests?|prompts?|conversations?))'
    r'(?:,? even (?:if|when) (?:it is |the task is )?unrelated)?\s*[.!]?$', re.IGNORECASE)
MENTION_TRIGGER = re.compile(
    r'^(?:use|invoke|activate)(?: (?:this|the) skill)? (?:when(?:ever)?|if) '
    r'(?:the )?(?:user|request|prompt) mentions?\b', re.IGNORECASE)
GENERIC_KEYWORDS = {'data', 'numbers', 'files', 'analysis', 'tasks', 'work', 'help', 'anything', 'everything'}


def lint_routing(doc):
    """Return metadata findings anchored to the opening frontmatter line.

The YAML parser owns scalar folding, quoting, duplicate keys and type decoding.
Missing dependencies propagate to the CLI as environment failures.
"""
    findings = []

    def add(rule, level, message):
        findings.append({'rule': rule, 'level': level, 'file': doc.path.as_posix(),
                         'line': 1, 'message': message})

    if not doc.body_start:
        add('routing-metadata-format', 'high', 'Routing lint requires a closed YAML frontmatter block')
        return findings
    try:
        data = parse_frontmatter('\n'.join(doc.lines[1:doc.body_start - 1]))
    except ValueError as exc:
        add('routing-metadata-format', 'high', str(exc))
        return findings

    for key in ('description', 'when_to_use'):
        value = data.get(key)
        if value is None and key not in data:
            continue
        if not isinstance(value, str):
            add('routing-metadata-format', 'high', f"'{key}' must be a string")
            continue
        # Literal blocks can contain quoted teaching examples and code fences;
        # reuse body marking without applying any body pressure rules.
        examples = type(doc)(doc.path, value)
        for _, line in examples.active():
            for sentence in re.split(r'(?<=[.!?])\s+', line.strip()):
                if ROUTING_PRESSURE.fullmatch(sentence):
                    add('routing-pressure', 'low', f'{key}: unconditional activation pressure; review the task boundary')
                words = set(re.findall(r'\b\w+\b', sentence.lower()))
                if MENTION_TRIGGER.match(sentence) and len(words & GENERIC_KEYWORDS) >= 4:
                    add('routing-keyword-scope', 'low', f'{key}: activation by several generic mentions; evaluate adjacent negative cases')

    keywords = data.get('keywords', [])
    if not isinstance(keywords, list) or not all(isinstance(item, str) for item in keywords):
        add('routing-metadata-format', 'high', "'keywords' must be a list of strings")
    elif len({word.lower().strip() for word in keywords} & GENERIC_KEYWORDS) >= 4:
        add('routing-keyword-scope', 'low', 'keywords: several generic routing terms; review against the owned task and competing skills')
    return findings

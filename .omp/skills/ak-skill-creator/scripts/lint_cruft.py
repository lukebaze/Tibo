#!/usr/bin/env python3
"""Report prompt cruft in skill, agent, output-style, and hook text.

Pattern matches identify instructions to review, not proven behavioral harm:
pressure walls, threat language, report-compression orders, delegation
suppressors, numeric caps, thinking scaffolds, and so on.
The rule table lives in references/prompt-cruft-patterns.md; rule ids here
match that table. The script only reports; it never edits.

Usage:
    python3 lint_cruft.py <path> [<path> ...] [--json] [--min-level low|medium|high]
                          [--fail-on high|medium|low|none] [--cross-file-duplicates] [--routing]

Paths may be files or directories. Directories are scanned recursively for
Markdown, and for scripts under a hooks/ directory (.cjs/.js/.mjs/.ts) with
the text-only rules; other scripts are skipped because their strings are
program output, not prompt text.

Default body lint uses only the standard library. --routing also parses SKILL.md
metadata with PyYAML and reports narrow activation advisories. Neither mode
establishes actual activation quality or resolves semantic contradictions;
those require contextual review and model evaluation.

Opt-outs:
    <!-- cruft-lint-allow: reason -->   on a line of its own, skips the whole file
    cruft-lint-allow                    trailing a content line, skips that line
    <!-- fragile --> ... <!-- /fragile -->  skips the block (exact scripts)
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from encoding_utils import configure_utf8_console, read_text_utf8
from frontmatter_validation import MissingDependencyError

configure_utf8_console()

LEVELS = {'low': 1, 'medium': 2, 'high': 3}
MARKDOWN_SUFFIXES = {'.md', '.markdown'}
SCRIPT_SUFFIXES = {'.cjs', '.js', '.mjs', '.ts'}
SKIP_DIRS = {'node_modules', '__pycache__', 'dist', 'build'}
# The file-level opt-out has to sit on a line of its own, so that the same
# marker trailing a content line stays a line-level opt-out and cannot
# silently disable the whole file.
FILE_ALLOW_MARKER = re.compile(r'^[ 	]*(?:<!--|//|#)\s*cruft-lint-allow:.*$', re.MULTILINE)
LINE_ALLOW_MARKER = 'cruft-lint-allow'
FRAGILE_OPEN = '<!-- fragile -->'
FRAGILE_CLOSE = '<!-- /fragile -->'

MIN_DUPLICATE_LENGTH = 60
# A line is prose when most of it is words rather than code, paths, or
# parameter names; repeated code and reference rows are not cruft.
CODE_SPAN = re.compile(r'`[^`]*`|\[[^\]]*\]\([^)]*\)|https?://\S+|[\w./\\-]+\.(?:md|py|cjs|js|ts|json|ya?ml)\b')


def normalize_instruction(line):
    """Strip list markers and surrounding emphasis so the same sentence keys alike."""
    text = re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)', '', line.strip())
    return text.strip('*_ ').strip()


def is_prose(line):
    stripped = re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)', '', line)
    without_code = CODE_SPAN.sub('', stripped)
    if len(stripped) == 0:
        return False
    return len(without_code.strip()) >= 0.5 * len(stripped) and len(without_code.split()) >= 6


PRESSURE_WORDS = re.compile(r'\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT|MANDATORY)\b')
REASON_WORDS = re.compile(r'\b(because|so that|otherwise|since|as it|which (?:means|keeps|prevents))\b', re.IGNORECASE)
PROHIBITION_START = re.compile(r"^(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?(?:Do not|Don't|Never|Avoid|DO NOT|NEVER|AVOID)\b")
STEP_HEADER = re.compile(r'^#{2,4}\s*Step\s+\d+', re.IGNORECASE)
ORDER_STATEMENT = re.compile(r'order matters|must run before|in this order|in order\b|ordered because|sequence exists', re.IGNORECASE)
DELEGATION_BOUNDARY = re.compile(
    r'\b(?:runtime|capabilit\w*|available tools?|authoriz\w*|permission\w*|'
    r'sandbox|budget|quota|concurrency|file ownership)\b', re.IGNORECASE)
IDENTITY_STUB = re.compile(r'^\s*You are (?:a|an) (?:helpful|expert|elite|senior|world-class|experienced)\b', re.IGNORECASE)
IDENTITY_CONTEXT = re.compile(r'\b(audience|product|users?|team|project|codebase|repository|customers?|readers?)\b', re.IGNORECASE)
VERIFICATION_RITUAL = re.compile(
    r'^(?:always\s+)?(?:'
    r'double[- ]check (?:your work|everything|your (?:answer|response|output)s?)'
    r'|(?:verify|check)(?: (?:your work|everything|your (?:answer|response|output)s?))? twice'
    r')(?: before (?:responding|answering|finishing|you (?:respond|answer|finish)))?[.!]?$',
    re.IGNORECASE)
VERIFICATION_CONDITION = re.compile(
    r'\b(?:if|when|unless|because|after|failure|error|retry|risk|safety|destructive)\b',
    re.IGNORECASE)
EXPLICIT_GATE = re.compile(r'--interactive|\b(?:destructive|irreversible|overwrite|delet\w*|user-requested)\b', re.IGNORECASE)
PROMPT_FENCE_LANGUAGES = {'', 'text', 'plaintext', 'markdown', 'md'}
FENCED_REASONING = re.compile(
    r'\bThought\s+(?:N|\d+)\s*/\s*(?:M|\d+)\b|<\s*(?:thinking|scratchpad)\s*>'
    r'|\b(?:show|write|output) (?:your |the )?(?:internal reasoning|chain of thought)\b', re.IGNORECASE)

# Simple regex rules: (rule_id, level, pattern, applies_to_scripts)
SIMPLE_RULES = [
    ('approval-loop', 'medium',
     re.compile(r'\b(?:approval|confirmation|permission)\b[^.\n]{0,45}'
                r'\b(?:each|every) (?:major )?(?:step|phase|action)\b', re.IGNORECASE), False),
    ('blanket-full-read', 'medium',
     re.compile(r'\bread\s+(?:all|every|the (?:entire|whole))\s+'
                r'(?:(?:API|reference|project|available|bundled)\s+){0,2}'
                r'(?:docs?|documentation|references?|specifications?|specs?)(?:\s+files?)?\b', re.IGNORECASE), False),
    ('threat-language', 'high',
     re.compile(r"(?-i:\bINCOMPLETE\b)|\b(?:do not|don't|never)\b(?!\s+repeat\s+yourself\b)[^.\n]{0,60}\byourself\b|\bnever skip\b|\bMANDATORY\s*[—–-]", re.IGNORECASE), False),
    ('report-compression', 'high', re.compile(r'sacrifice grammar', re.IGNORECASE), True),
    ('token-booster', 'high', re.compile(r'ensure token (?:consumption )?efficiency|be extremely concise', re.IGNORECASE), True),
    ('delegation-suppressor', 'high',
     re.compile(r"\b(?:avoid|do not|don't|never) (?:spawn(?:ing)?|delegat\w*) (?:(?:more|multiple|parallel|additional|several|other|any|new|extra|further) )?(?:sub-?agents?|agents?|delegates?|workers?|tasks?)\b|\bonly (?:spawn|delegate) when\b|(?:spawn\w*|delegat\w*|sub-?agents?|agents?)[^.]{0,60}?can cause performance issues", re.IGNORECASE), True),
    ('numeric-cap', 'medium',
     re.compile(r'\bat most \d+ (?:words|sentences|bullets|lines|paragraphs)\b|\b\d+(?:-\d+)? (?:sentences|words|bullets|lines) max\b|\bunder \d+ words\b|\bevery \d+ (?:tool calls|messages|turns)\b|\bmax(?:imum)? (?:of )?\d+ (?:words|sentences|bullets)\b', re.IGNORECASE), False),
    ('thinking-scaffold', 'high',
     re.compile(r'think step by step|<scratchpad>|<thinking>|take a deep breath'
                # Depth is a runtime effort setting on adaptive-reasoning models;
                # the keyword stacks a prose scaffold on native reasoning.
                r'|\bultrathink\b|\bthink (?:hard(?:er)?|deeply|more)\b'
                r'|^\**thinking level:', re.IGNORECASE | re.MULTILINE), True),
    ('thoroughness-booster', 'medium',
     re.compile(r'\bbe (?:very |maximally |extremely )?(?:thorough|comprehensive|exhaustive)\b'
                r'|\bresearch thoroughly\b|\bexhaustively\b|\bcomprehensive analysis\b'
                r'|\bleave no stone unturned\b|^\*\*Remember:\*\*', re.IGNORECASE | re.MULTILINE), False),
    # A skill cannot ask the runtime which model runs it: the hook payload
    # carries no model on UserPromptSubmit and only sometimes on SessionStart.
    # Branching prose on a model name therefore gates on an unverifiable fact
    # that also goes stale as tiers ship; state the capability instead.
    ('model-name-conditional', 'medium',
     re.compile(r"\b(?:on|for|when running on|if (?:you(?:'re| are) )?(?:on|running on))\s+"
                r"(?:claude\s+|openai\s+|google\s+)?"
                r"(?:opus|sonnet|haiku|fable|gpt|gemini)[\w.\-]*(?:\s+\d[\w.\-]*)?"
                r"(?:\s+(?:and|or)\s+(?:claude\s+|openai\s+|google\s+)?"
                r"(?:opus|sonnet|haiku|fable|gpt|gemini)[\w.\-]*(?:\s+\d[\w.\-]*)?)?"
                r"[,:]?\s+(?:the model|you|apply|run|skip|use|prefer|omit|do not|don't)\b",
                re.IGNORECASE), False),
    ('anti-formatting', 'medium',
     re.compile(r'\b(?:never|do not|don\'t) use (?:bullets|bullet points|headers|headings|bold|markdown)\b'
                # "no headers" is also how a CSV or an HTTP response gets
                # described, so the bare noun needs a verb that introduces an
                # instruction. A finding still wrong for its own line takes a
                # trailing cruft-lint-allow.
                r'|\b(?:answer|deliver|format|give|keep|output|reply|respond|return|use|write)[^.]{0,40}?\bno (?:bullet|header|heading)s?\b'
                r'|\bno bullet points\b|\bplain text only\b', re.IGNORECASE), True),
    ('narration-suppressor', 'high', re.compile(r"\bhold (?:all )?(?:findings|results)\b|\b(?:don't|do not) narrate\b|\bno interim\b", re.IGNORECASE), True),
    ('volatile-fact', 'medium',
     re.compile(r'\b\d{2,3}K tokens\b|\bclaude-[0-9]|\b(?:claude|sonnet|opus|haiku|fable)[- ]?[3-9](?:\.[0-9])?\b', re.IGNORECASE), False),
    ('migration-phrasing', 'low', re.compile(r'\bno longer\b|\bnow (?:works|uses|supports)\b|\bpreviously\b|\bused to\b', re.IGNORECASE), False),
    ('budget-countdown', 'high',
     # A bare percentage is any quota report, so the rule needs the model own
     # budget named somewhere in the same sentence, before or after it.
     re.compile(r'(?:context|window|budget|token usage)[^.]{0,40}?%\s*used\b|%\s*used\b[^.]{0,40}?(?:context|tokens?)|\btokens? (?:left|remaining)\b|\bcontext (?:nearly|almost) full\b|\bremaining context\b', re.IGNORECASE), True),
]


def iter_files(paths):
    for raw in paths:
        path = Path(raw)
        if path.is_file():
            yield path
            continue
        if not path.is_dir():
            continue
        for candidate in sorted(path.rglob('*')):
            # Dot-directories under the walked root hold tooling and retired
            # material that no runtime loads, so counting their findings would
            # misreport the prompt surface that actually ships. Only the part
            # below the root is judged: a root that itself sits under a dot
            # directory, such as a user-scope skills root, still gets scanned.
            relative = candidate.relative_to(path)
            if any(part in SKIP_DIRS or part.startswith('.') for part in relative.parts):
                continue
            if not candidate.is_file():
                continue
            suffix = candidate.suffix.lower()
            if suffix in MARKDOWN_SUFFIXES:
                yield candidate
            elif suffix in SCRIPT_SUFFIXES and 'hooks' in candidate.parts:
                yield candidate


def _fence_marker(stripped):
    """Return (char, run length) when the line opens or closes a code fence."""
    for char in ('`', '~'):
        if stripped.startswith(char * 3):
            width = len(stripped) - len(stripped.lstrip(char))
            return char, width
    return None


class Document:
    """A file split into scannable lines with per-line skip flags."""

    def __init__(self, path, text):
        self.path = path
        self.is_markdown = path.suffix.lower() in MARKDOWN_SUFFIXES
        self.lines = text.splitlines()
        self.body_start = 0
        self.prompt_examples = set()
        self.skip = [False] * len(self.lines)
        self.in_table = [False] * len(self.lines)
        self._mark()

    def _mark(self):
        lines = self.lines
        if self.is_markdown and lines and lines[0].strip() == '---':
            for index in range(1, len(lines)):
                if lines[index].strip() == '---':
                    self.body_start = index + 1
                    break
            for index in range(0, self.body_start):
                self.skip[index] = True
        fence = None
        prompt_fence = False
        in_fragile = False
        for index, line in enumerate(lines):
            stripped = line.strip()
            marker = _fence_marker(stripped) if self.is_markdown else None
            if marker is not None:
                char, width = marker
                if fence is None:
                    fence = marker
                    language = stripped[width:].strip().lower()
                    prompt_fence = language in PROMPT_FENCE_LANGUAGES
                    self.skip[index] = True
                    continue
                # A fence only closes on the same character and at least the
                # opening width, so a three-backtick block nested inside a
                # four-backtick one does not end the outer block early.
                if char == fence[0] and width >= fence[1]:
                    fence = None
                    self.skip[index] = True
                    continue
            in_fence = fence is not None
            if FRAGILE_OPEN in stripped:
                in_fragile = True
            if (in_fence and prompt_fence and not in_fragile
                    and LINE_ALLOW_MARKER not in line and index >= self.body_start):
                self.prompt_examples.add(index)
            if in_fence or in_fragile or LINE_ALLOW_MARKER in line:
                self.skip[index] = True
            if FRAGILE_CLOSE in stripped:
                in_fragile = False
            if self.is_markdown and stripped.startswith('|'):
                self.in_table[index] = True

    def active(self):
        for index, line in enumerate(self.lines):
            if not self.skip[index]:
                yield index + 1, line


def lint_document(doc):
    findings = []

    def add(rule, level, line, message):
        findings.append({'rule': rule, 'level': level, 'file': doc.path.as_posix(), 'line': line, 'message': message})

    for rule, level, pattern, applies_to_scripts in SIMPLE_RULES:
        if not doc.is_markdown and not applies_to_scripts:
            continue
        for number, line in doc.active():
            match = pattern.search(line)
            if match:
                if rule == 'approval-loop' and EXPLICIT_GATE.search(line):
                    continue
                if rule == 'blanket-full-read' and REASON_WORDS.search(line):
                    continue
                if rule == 'delegation-suppressor':
                    context = ' '.join(doc.lines[max(0, number - 2):number + 1])
                    if DELEGATION_BOUNDARY.search(context) and REASON_WORDS.search(context):
                        # An explained capability/authority/resource constraint is a
                        # legitimate boundary, not evidence of obsolete prompting.
                        continue
                add(rule, level, number, f'"{match.group(0).strip()}"')

    if not doc.is_markdown:
        return findings

    # Only generic, direct repeated-check instructions are advisory. Specific
    # assertions, conditional retries, and quoted examples are not this rule.
    for number, line in doc.active():
        if doc.in_table[number - 1]:
            continue
        preceding = doc.lines[number - 2] if number > 1 else ''
        following = doc.lines[number] if number < len(doc.lines) else ''
        if (VERIFICATION_CONDITION.search(line + ' ' + preceding)
                or re.match(r'^\s*(?:if|when|unless|because|after)\b', following, re.IGNORECASE)):
            continue
        for sentence in re.split(r'(?<=[.!?])\s+', normalize_instruction(line)):
            if VERIFICATION_RITUAL.fullmatch(sentence):
                add('verification-ritual', 'low', number,
                    'generic repeated verification; retain checks justified by risk, new evidence, or failure')
                break
    # Only prompt-shaped examples get this diagnostic. Ordinary code fences
    # retain their existing exemptions; exact protocol fixtures can opt out.
    for index in sorted(doc.prompt_examples):
        match = FENCED_REASONING.search(doc.lines[index])
        if match:
            add('fenced-reasoning', 'medium', index + 1,
                f'prompt example requests a reasoning transcript: "{match.group(0)}"')

    # pressure-density and emphasis-no-reason
    pressure_lines = []
    for number, line in doc.active():
        count = len(PRESSURE_WORDS.findall(line))
        if count and not REASON_WORDS.search(line):
            pressure_lines.append((number, count))
    total = sum(count for _, count in pressure_lines)
    window_hit = False
    for i, (start, _) in enumerate(pressure_lines):
        window = sum(count for number, count in pressure_lines[i:] if number < start + 10)
        if window >= 3:
            window_hit = True
            break
    if total >= 8 or window_hit:
        add('pressure-density', 'high', pressure_lines[0][0],
            f'{total} pressure words without a reason in body text' + (' (3+ within 10 lines)' if window_hit else ''))
    elif total >= 4:
        add('pressure-density', 'medium', pressure_lines[0][0], f'{total} pressure words without a reason in body text')
    for number, _ in pressure_lines:
        neighbours = doc.lines[max(0, number - 3):number + 2]
        if not any(REASON_WORDS.search(text) for text in neighbours):
            add('emphasis-no-reason', 'medium', number, 'emphasis with no reason within two lines')

    # duplicate-line (within file): a repeated instruction, not a repeated
    # command, path, or parameter row, which legitimately appear twice.
    seen = defaultdict(list)
    for number, line in doc.active():
        if doc.in_table[number - 1]:
            continue
        key = normalize_instruction(line)
        if len(key) >= MIN_DUPLICATE_LENGTH and not key.startswith('#') and is_prose(key):
            seen[key].append(number)
    for key, numbers in seen.items():
        if len(numbers) > 1:
            add('duplicate-line', 'medium', numbers[1], f'line repeats line {numbers[0]}: "{key[:60]}"')

    # step-choreography
    step_headers = [number for number, line in doc.active() if STEP_HEADER.match(line)]
    if len(step_headers) >= 4 and not any(ORDER_STATEMENT.search(line) for _, line in doc.active()):
        add('step-choreography', 'low', step_headers[0], f'{len(step_headers)} Step headers with no statement that order matters')

    # prohibition-run
    run = []
    for number, line in doc.active():
        stripped = line.strip()
        if stripped == '':
            run = []
            continue
        if PROHIBITION_START.match(stripped) and not REASON_WORDS.search(stripped):
            run.append(number)
            if len(run) == 3:
                add('prohibition-run', 'medium', run[0], 'three or more consecutive prohibitions without reasons')
        else:
            run = []

    # identity-stub
    for number, line in doc.active():
        if IDENTITY_STUB.match(line):
            following = ' '.join(doc.lines[number:number + 10])
            if not IDENTITY_CONTEXT.search(following):
                add('identity-stub', 'low', number, 'identity line with no audience or product context nearby')

    return findings


def cross_file_duplicates(docs, min_files=5, min_length=60):
    """Report long prose lines that recur across many Markdown files.

    Off by default (--cross-file-duplicates), and Low when enabled: each
    agent, skill, and output style is loaded into its own context, so the
    same instruction in many files is per-file instruction rather than
    duplication the model must reconcile. Enable it when auditing files that
    do share one context, or to find boilerplate worth centralising.
    """
    findings = []
    occurrences = defaultdict(dict)
    for doc in docs:
        if not doc.is_markdown:
            continue
        for number, line in doc.active():
            key = normalize_instruction(line)
            if (len(key) >= min_length and not doc.in_table[number - 1]
                    and not key.startswith('#') and is_prose(key)):
                occurrences[key].setdefault(doc.path.as_posix(), number)
    for key, files in occurrences.items():
        if len(files) >= min_files:
            for file, number in files.items():
                findings.append({'rule': 'duplicate-line', 'level': 'low', 'file': file, 'line': number,
                                 'message': f'boilerplate shared by {len(files)} files: "{key[:60]}"'})
    return findings


def lint_paths(paths, cross_file=False, routing=False):
    docs = []
    skipped = []
    findings = []
    for path in iter_files(paths):
        try:
            text = read_text_utf8(path)
        except (OSError, UnicodeDecodeError):
            skipped.append({'file': path.as_posix(), 'reason': 'unreadable'})
            continue
        if FILE_ALLOW_MARKER.search(text):
            skipped.append({'file': path.as_posix(), 'reason': 'cruft-lint-allow'})
            continue
        doc = Document(path, text)
        docs.append(doc)
        findings.extend(lint_document(doc))
        if routing and path.name == 'SKILL.md':
            from metadata_routing import lint_routing
            findings.extend(lint_routing(doc))
    if cross_file:
        findings.extend(cross_file_duplicates(docs))
    findings.sort(key=lambda item: (-LEVELS[item['level']], item['file'], item['line']))
    return {'files_scanned': len(docs), 'skipped': skipped, 'findings': findings}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Report prompt cruft in skill and agent text.')
    parser.add_argument('paths', nargs='+', help='Files or directories to scan')
    parser.add_argument('--json', action='store_true', help='Emit a JSON report')
    parser.add_argument('--min-level', choices=LEVELS, default='low', help='Lowest level to report')
    parser.add_argument('--cross-file-duplicates', action='store_true',
                        help='Also report long prose lines repeated across files (Low; off by default '
                             'because each file is loaded into its own context)')
    parser.add_argument('--routing', action='store_true',
                        help='Also lint SKILL.md routing metadata (requires PyYAML); '
                             'advisories do not replace model evaluation')
    parser.add_argument('--fail-on', choices=[*LEVELS, 'none'], default='high',
                        help='Exit 1 when a finding at or above this level exists')
    args = parser.parse_args(argv)

    try:
        report = lint_paths(args.paths, cross_file=args.cross_file_duplicates, routing=args.routing)
    except MissingDependencyError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    threshold = LEVELS[args.min_level]
    report['findings'] = [f for f in report['findings'] if LEVELS[f['level']] >= threshold]
    counts = Counter(f['level'] for f in report['findings'])
    report['summary'] = {level: counts.get(level, 0) for level in LEVELS}

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for item in report['findings']:
            print(f"{item['level'].upper():6} {item['rule']:22} {item['file']}:{item['line']}  {item['message']}")
        print(f"{report['files_scanned']} file(s) scanned, {len(report['skipped'])} skipped; "
              f"high={report['summary']['high']} medium={report['summary']['medium']} low={report['summary']['low']}")

    if args.fail_on == 'none':
        return 0
    fail_level = LEVELS[args.fail_on]
    return 1 if any(LEVELS[f['level']] >= fail_level for f in report['findings']) else 0


if __name__ == '__main__':
    sys.exit(main())

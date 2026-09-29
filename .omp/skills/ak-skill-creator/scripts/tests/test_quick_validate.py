import builtins
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import quick_validate  # noqa: E402
from frontmatter_validation import MissingDependencyError  # noqa: E402


@contextmanager
def missing_yaml():
    """Simulate PyYAML not being installed, without touching sys.modules."""
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == 'yaml':
            raise ImportError("No module named 'yaml'")
        return real_import(name, *args, **kwargs)

    builtins.__import__ = fake_import
    try:
        yield
    finally:
        builtins.__import__ = real_import


def write_skill(root, name, frontmatter_extra='', body='# Skill\n\nBody.\n', description='Create PDF files from Markdown.'):
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    content = f'---\nname: {name}\ndescription: "{description}"\n{frontmatter_extra}---\n\n{body}'
    (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
    return skill_dir


class ParseIdentifierTests(unittest.TestCase):
    def test_plain_and_namespaced(self):
        self.assertEqual(quick_validate.parse_identifier('my-skill'), ('my-skill', None, 'my-skill'))
        self.assertEqual(quick_validate.parse_identifier('ak:my-skill'), ('ak:my-skill', 'ak', 'my-skill'))

    def test_rejects_bad_shapes(self):
        for bad in ('My-Skill', '-lead', 'trail-', 'dou--ble', 'a:b:c', 'x' * 65):
            with self.assertRaises(ValueError, msg=bad):
                quick_validate.parse_identifier(bad)

    def test_accepts_64_character_slug(self):
        slug = 'a' * 64
        self.assertEqual(quick_validate.parse_identifier(slug)[2], slug)


class ReadScalarTests(unittest.TestCase):
    def test_folded_block_scalar_is_measured(self):
        frontmatter = 'name: x\ndescription: >-\n  first line\n  second line\nother: y'
        self.assertEqual(quick_validate.read_scalar(frontmatter, 'description'), 'first line second line')

    def test_literal_block_scalar_and_quotes(self):
        frontmatter = 'description: |\n  one\n  two\nname: "quoted"'
        self.assertEqual(quick_validate.read_scalar(frontmatter, 'description'), 'one\ntwo')
        self.assertEqual(quick_validate.read_scalar(frontmatter, 'name'), 'quoted')

    def test_missing_key(self):
        self.assertIsNone(quick_validate.read_scalar('name: x', 'description'))


class ValidateSkillTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_valid_project_skill(self):
        skill = write_skill(self.root, 'good-skill')
        ok, message = quick_validate.validate_skill(skill, kit=False)
        self.assertTrue(ok, message)

    def test_short_description_has_no_length_warning(self):
        skill = write_skill(self.root, 'short-description')
        result = quick_validate.validate_skill_detailed(skill, kit=False)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['warnings'], [])

    def test_description_length_boundary_and_format_are_preserved(self):
        for description, valid in (('x' * 1024, True), ('x' * 1025, False),
                                   ('Create <pdf> files.', False), ('', False)):
            with self.subTest(length=len(description)):
                skill = write_skill(self.root, 'boundary', description=description)
                result = quick_validate.validate_skill_detailed(skill, kit=False)
                self.assertEqual(not result['errors'], valid, result)

    def test_block_scalar_description_over_limit_fails(self):
        skill = self.root / 'long-desc'
        skill.mkdir()
        long_text = '\n'.join('  ' + ('word ' * 30) for _ in range(8))
        (skill / 'SKILL.md').write_text(f'---\nname: long-desc\ndescription: >-\n{long_text}\n---\n# x\n', encoding='utf-8')
        result = quick_validate.validate_skill_detailed(skill, kit=False)
        self.assertTrue(any('exceeds 1024' in e['message'] for e in result['errors']), result)

    def test_broken_reference_link_fails(self):
        skill = write_skill(self.root, 'links', body='See `references/missing.md` and `scripts/present.py`.\n')
        (skill / 'scripts').mkdir()
        (skill / 'scripts' / 'present.py').write_text('', encoding='utf-8')
        result = quick_validate.validate_skill_detailed(skill, kit=False)
        messages = [e['message'] for e in result['errors']]
        self.assertTrue(any('references/missing.md' in m for m in messages), messages)
        self.assertFalse(any('scripts/present.py' in m for m in messages), messages)
        broken = next(e for e in result['errors'] if 'references/missing.md' in e['message'])
        source = (skill / 'SKILL.md').read_text(encoding='utf-8').splitlines()
        self.assertEqual(source[broken['line'] - 1], 'See `references/missing.md` and `scripts/present.py`.')

    def test_directory_and_asset_targets_are_not_errors(self):
        skill = write_skill(self.root, 'outputs',
                            body='Writes to `assets/reports/` and `assets/out/report.png`.\n')
        result = quick_validate.validate_skill_detailed(skill, kit=False)
        self.assertEqual(result['errors'], [])
        self.assertTrue(any('assets/out/report.png' in w['message'] for w in result['warnings']),
                        result['warnings'])
        self.assertFalse(any('assets/reports/' in w['message'] for w in result['warnings']),
                         result['warnings'])

    def test_line_limit_warns_without_failing(self):
        skill = write_skill(self.root, 'too-long', body='line\n' * 301)
        result = quick_validate.validate_skill_detailed(skill, kit=False)
        self.assertEqual(result['errors'], [])
        self.assertTrue(any('keeps it loadable' in w['message'] for w in result['warnings']), result)

    def test_kit_checks_native_tool_names_and_when_to_use(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-tools', body='Use the `Read` tool here.\nAllowed: Bash(python:*) capability-lint-allow: example\n')
        (skill / 'SKILL.md').write_text((skill / 'SKILL.md').read_text(encoding='utf-8').replace('name: ak-tools', 'name: ak:tools'), encoding='utf-8')
        result = quick_validate.validate_skill_detailed(skill)
        self.assertTrue(result['kit'])
        tool_errors = [e for e in result['errors'] if 'Native tool name' in e['message']]
        self.assertEqual(len(tool_errors), 1, result['errors'])
        self.assertIn("'Read'", tool_errors[0]['message'])
        self.assertTrue(any('when_to_use' in w['message'] for w in result['warnings']), result['warnings'])

    def test_allowed_tools_frontmatter_is_exempt(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-hosted',
                            frontmatter_extra='allowed-tools: Bash(python:*), Read\n',
                            body='# Skill\n\nBody.\n')
        result = quick_validate.validate_skill_detailed(skill)
        self.assertEqual([e for e in result['errors'] if 'Native tool name' in e['message']], [])

    def test_allowed_tools_block_sequence_is_exempt(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-listed',
                            frontmatter_extra='allowed-tools:\n- Bash(git log:*)\n- Read\n',
                            body='# Skill\n\nBody.\n')
        result = quick_validate.validate_skill_detailed(skill)
        self.assertEqual([e for e in result['errors'] if 'Native tool name' in e['message']], [])

    def test_standalone_marker_exempts_the_following_line(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-marked',
                            body='<!-- capability-lint-allow: naming the tool is the point -->\n'
                                 'Ask with the `AskUserQuestion` tool.\n')
        result = quick_validate.validate_skill_detailed(skill)
        self.assertEqual([e for e in result['errors'] if 'Native tool name' in e['message']], [])

    def test_marker_beside_a_tool_name_exempts_only_its_own_line(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-trailing',
                            body='Use `Bash` here. capability-lint-allow: example\n'
                                 'Then use the `Read` tool.\n')
        result = quick_validate.validate_skill_detailed(skill)
        tool_errors = [e for e in result['errors'] if 'Native tool name' in e['message']]
        self.assertEqual(len(tool_errors), 1, result['errors'])
        self.assertIn("'Read'", tool_errors[0]['message'])

    def test_every_tool_on_a_line_is_reported(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-many',
                            body='Call `Read` and then `Grep`.\n')
        result = quick_validate.validate_skill_detailed(skill)
        tools = sorted(e['message'].split("'")[1] for e in result['errors']
                       if 'Native tool name' in e['message'])
        self.assertEqual(tools, ['Grep', 'Read'])

    def test_nested_reference_directories_are_scanned(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-nested')
        nested = skill / 'references' / 'deep'
        nested.mkdir(parents=True)
        (nested / 'guide.md').write_text('Read it with the `Read` tool.\n', encoding='utf-8')
        result = quick_validate.validate_skill_detailed(skill)
        self.assertTrue(any(e['file'] == 'references/deep/guide.md' for e in result['errors']),
                        result['errors'])

    def test_missing_skill_md(self):
        ok, message = quick_validate.validate_skill(self.root / 'nope')
        self.assertFalse(ok)
        self.assertIn('SKILL.md not found', message)

    def test_real_sibling_skill_and_docs_links_are_not_errors(self):
        skills_dir = self.root / 'kits' / 'core' / 'skills'
        skill = write_skill(skills_dir, 'ak-linker',
                            body='See [sibling](../ak-friend/SKILL.md) and '
                                 '[docs](../../../../docs/notes.md).\n')
        write_skill(skills_dir, 'ak-friend')
        docs = self.root / 'docs'
        docs.mkdir()
        (docs / 'notes.md').write_text('notes', encoding='utf-8')
        result = quick_validate.validate_skill_detailed(skill)
        self.assertEqual([e for e in result['errors'] if 'outside the skill directory' in e['message']], [])

    def test_broken_sibling_skill_and_docs_links_still_error(self):
        skills_dir = self.root / 'kits' / 'core' / 'skills'
        skill = write_skill(skills_dir, 'ak-linker',
                            body='See [sibling](../ak-missing/SKILL.md) and '
                                 '[docs](../../../../docs/missing.md).\n')
        result = quick_validate.validate_skill_detailed(skill)
        messages = [e['message'] for e in result['errors'] if 'outside the skill directory' in e['message']]
        self.assertTrue(any('ak-missing/SKILL.md' in m for m in messages), messages)
        self.assertTrue(any('docs/missing.md' in m for m in messages), messages)

    def test_link_outside_the_repo_entirely_still_errors(self):
        skill = write_skill(self.root / 'kits' / 'core' / 'skills', 'ak-escapee',
                            body='See [far](../../../../../../etc/some-config.conf).\n')
        result = quick_validate.validate_skill_detailed(skill)
        messages = [e['message'] for e in result['errors'] if 'outside the skill directory' in e['message']]
        self.assertTrue(any('some-config.conf' in m for m in messages), messages)


class MissingDependencyTests(unittest.TestCase):
    """A missing PyYAML is an environment fault, not a skill-content error."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.skill = write_skill(Path(self.tmp.name), 'good-skill')

    def test_validate_skill_detailed_raises_a_distinct_exception(self):
        with missing_yaml():
            with self.assertRaises(MissingDependencyError):
                quick_validate.validate_skill_detailed(self.skill, kit=False)

    def test_cli_reports_a_distinct_exit_code(self):
        with missing_yaml():
            rc = quick_validate.main([str(self.skill), '--no-kit'])
        self.assertEqual(rc, 3)

    def test_package_skill_does_not_report_validation_failed(self):
        import io
        from contextlib import redirect_stdout

        import package_skill

        buf = io.StringIO()
        with missing_yaml(), redirect_stdout(buf):
            result = package_skill.package_skill(self.skill, self.tmp.name)
        output = buf.getvalue()
        self.assertIsNone(result)
        self.assertNotIn('Validation failed', output)
        self.assertIn('PyYAML is not installed', output)


if __name__ == '__main__':
    unittest.main()

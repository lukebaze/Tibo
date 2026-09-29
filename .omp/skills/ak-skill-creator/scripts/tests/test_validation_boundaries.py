import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quick_validate import validate_skill_detailed
from init_skill import init_skill
from lint_cruft import Document, lint_document


class ValidationBoundariesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.skill = self.root / 'sample'
        self.skill.mkdir()

    def write(self, extra='', description='"Analyze local records when asked for record analysis."', body='Read the records.'):
        (self.skill / 'SKILL.md').write_text(
            f'---\nname: sample\ndescription: {description}\n{extra}---\n# Sample\n{body}\n', encoding='utf-8')

    def errors(self):
        return validate_skill_detailed(self.skill, kit=False)['errors']

    def test_rejects_malformed_unsafe_and_duplicate_yaml(self):
        for extra in ('metadata: [\n', 'metadata: !!python/object:builtins.object {}\n',
                      'name: other\n', 'metadata:\n  version: "1.0.0"\n  version: "2.0.0"\n'):
            with self.subTest(extra=extra):
                self.write(extra)
                self.assertTrue(self.errors())

    def test_requires_typed_description(self):
        for value in ('null', 'false', '123', '[]', '{}', '"   "'):
            with self.subTest(value=value):
                self.write(description=value)
                self.assertTrue(self.errors())

    def test_validates_optional_field_types(self):
        for extra in ('metadata: []\n', 'user-invocable: "yes"\n', 'keywords: [false]\n',
                      'metadata:\n  version: 1\n', 'when_to_use: false\n'):
            with self.subTest(extra=extra):
                self.write(extra)
                self.assertTrue(self.errors())

    def test_preserves_quoted_escapes_comments_and_folded_yaml(self):
        self.write('metadata:\n  version: "1.0.0"\n', description='"Use C:\\\\data for \\"records\\"." # comment')
        self.assertEqual(self.errors(), [])

    def test_checks_transitive_root_and_file_relative_resources(self):
        self.write(body='Read `references/guide.md`.')
        refs = self.skill / 'references'
        refs.mkdir()
        (refs / 'guide.md').write_text('Run `scripts/missing.py`.\nRead [details](./missing.md).\n')
        errors = self.errors()
        self.assertEqual(len(errors), 2, errors)
        self.assertTrue(all(e['file'] == 'references/guide.md' for e in errors))

    def test_checks_fenced_commands_except_explicit_illustrations(self):
        self.write(body='Read `references/guide.md`.')
        refs = self.skill / 'references'
        refs.mkdir()
        (refs / 'guide.md').write_text('```bash\npython scripts/example.py # resource-link-example: illustration\npython scripts/real.py\n```\n')
        errors = self.errors()
        self.assertEqual(len(errors), 1, errors)
        self.assertIn('real.py', errors[0]['message'])

    def test_rejects_outside_symlink_and_relative_escape(self):
        self.write(body='Read [outside](../outside.txt).')
        (self.root / 'outside.txt').write_text('fabricated fixture')
        self.assertTrue(self.errors())
        (self.skill / 'SKILL.md').unlink()
        try:
            (self.skill / 'SKILL.md').symlink_to(self.root / 'outside.txt')
        except OSError:
            self.skipTest('File symlinks unavailable for this account')
        self.assertIn('outside', self.errors()[0]['message'])

    def test_initializer_is_invalid_until_authored(self):
        generated = init_skill('unfinished', self.root)
        self.assertTrue(validate_skill_detailed(generated)['errors'])

    def test_capability_and_authorization_conditions_are_not_cruft(self):
        text = ('# Scope\nOnly delegate when the runtime exposes delegation and the user has '
                'authorized parallel work, because unavailable tools cannot execute.\n')
        findings = lint_document(Document(Path('SKILL.md'), text))
        self.assertFalse(any(f['rule'] == 'delegation-suppressor' for f in findings))
        unexplained = lint_document(Document(Path('SKILL.md'), '# Scope\nNever spawn agents.\n'))
        self.assertTrue(any(f['rule'] == 'delegation-suppressor' for f in unexplained))


if __name__ == '__main__':
    unittest.main()

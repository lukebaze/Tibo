import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import init_skill  # noqa: E402
import lint_cruft  # noqa: E402
import quick_validate  # noqa: E402


class InitSkillTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_project_skill_skeleton(self):
        skill_dir = init_skill.init_skill('data-cleaner', self.root)
        self.assertEqual(skill_dir, self.root / 'data-cleaner')
        content = (skill_dir / 'SKILL.md').read_text(encoding='utf-8')
        self.assertTrue(content.startswith('---\nname: data-cleaner\n'))
        self.assertNotIn('user-invocable', content)
        self.assertLessEqual(content.count('\n'), 30)
        self.assertEqual(sorted(p.name for p in skill_dir.iterdir()), ['SKILL.md'])

    def test_kit_skill_skeleton_uses_ak_namespace(self):
        skill_dir = init_skill.init_skill('data-cleaner', self.root / 'kits' / 'core' / 'skills', kit='core')
        self.assertEqual(skill_dir.name, 'ak-data-cleaner')
        content = (skill_dir / 'SKILL.md').read_text(encoding='utf-8')
        for token in ('name: ak:data-cleaner', 'user-invocable: true', 'when_to_use:', 'keywords: [data]', 'argument-hint:', 'version: "0.1.0"'):
            self.assertIn(token, content)

    def test_kit_rejects_foreign_namespace(self):
        with self.assertRaises(ValueError):
            init_skill.init_skill('team:thing', self.root, kit='core')

    def test_existing_directory_is_not_overwritten(self):
        init_skill.init_skill('twice', self.root)
        with self.assertRaises(FileExistsError):
            init_skill.init_skill('twice', self.root)

    def test_skeleton_requires_authoring_and_passes_cruft_lint(self):
        skill_dir = init_skill.init_skill('clean-start', self.root / 'kits' / 'core' / 'skills', kit='core',
                                          description='Clean tabular exports before import. Use when the user shares a CSV, mentions a dataset, or asks to normalise columns. Not for charting; that belongs to the reporting skill.')
        result = quick_validate.validate_skill_detailed(skill_dir)
        self.assertTrue(any('placeholder' in error['message'] for error in result['errors']), result)
        report = lint_cruft.lint_paths([str(skill_dir)])
        self.assertEqual([f for f in report['findings'] if f['level'] == 'high'], [], report)

    def test_multiline_description_stays_one_yaml_scalar(self):
        skill_dir = init_skill.init_skill('wrapped', self.root,
                                          description='First line.\nSecond "line" spans on.')
        frontmatter = (skill_dir / 'SKILL.md').read_text(encoding='utf-8').split('---')[1]
        self.assertEqual(quick_validate.read_scalar(frontmatter, 'description'), 'First line. Second "line" spans on.')

    def test_main_reports_errors(self):
        self.assertEqual(init_skill.main(['Bad Name', '--path', str(self.root)]), 1)
        self.assertEqual(init_skill.main(['fine', '--path', str(self.root)]), 0)


if __name__ == '__main__':
    unittest.main()

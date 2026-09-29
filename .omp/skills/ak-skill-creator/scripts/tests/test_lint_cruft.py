import builtins
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import lint_cruft  # noqa: E402


def rules_for(text, name='SKILL.md'):
    doc = lint_cruft.Document(Path(name), text)
    return {(f['rule'], f['level']) for f in lint_cruft.lint_document(doc)}


class SimpleRuleTests(unittest.TestCase):
    def test_report_compression_and_token_booster(self):
        text = '# A\n\nSacrifice grammar for the sake of concision when writing reports.\nIMPORTANT: Ensure token consumption efficiency while maintaining high quality.\n'
        found = rules_for(text)
        self.assertIn(('report-compression', 'high'), found)
        self.assertIn(('token-booster', 'high'), found)

    def test_threat_language(self):
        text = '# A\n\nIf delegate calls = 0 at end, workflow is INCOMPLETE.\nDO NOT run tests yourself - DELEGATE.\nStep 1 (MANDATORY — never skip)\n'
        self.assertIn(('threat-language', 'high'), rules_for(text))

    def test_delegation_suppressor(self):
        text = '# A\n\nAvoid spawning multiple sub-agents at once because it can cause performance issues.\n'
        self.assertIn(('delegation-suppressor', 'high'), rules_for(text))
        self.assertNotIn(('delegation-suppressor', 'high'), rules_for('# A\n\nCheck the port first; do not spawn a duplicate dev server.\n'))

    def test_instruction_verbs_beyond_the_writing_ones_still_count(self):
        for line in ('Use no headers.', 'Keep the summary to no bullets.'):
            self.assertIn(('anti-formatting', 'medium'), rules_for('# A\n\n' + line + '\n'), line)

    def test_budget_subject_may_follow_the_percentage(self):
        self.assertIn(('budget-countdown', 'high'),
                      rules_for('# A\n\n45% used of the context window.\n'))
        self.assertIn(('budget-countdown', 'high'),
                      rules_for('# A\n\nToken usage: 85% used.\n'))

    def test_no_headers_needs_an_instruction_subject(self):
        self.assertNotIn(('anti-formatting', 'medium'),
                         rules_for('# A\n\nThe CSV export has no headers.\n'))
        self.assertIn(('anti-formatting', 'medium'),
                      rules_for('# A\n\nWrite the handoff with no headers.\n'))

    def test_current_generation_model_names_are_volatile(self):
        self.assertIn(('volatile-fact', 'medium'),
                      rules_for('# A\n\nRoute the counsel request to Fable 5.\n'))

    def test_performance_warning_needs_a_delegation_subject(self):
        self.assertNotIn(('delegation-suppressor', 'high'),
                         rules_for('# A\n\nA very large JS bundle can cause performance issues on mobile.\n'))
        self.assertIn(('delegation-suppressor', 'high'),
                      rules_for('# A\n\nSpawning extra agents can cause performance issues.\n'))

    def test_percent_used_needs_a_context_subject(self):
        self.assertNotIn(('budget-countdown', 'high'),
                         rules_for('# A\n\nThe dashboard shows 45% used of the monthly quota.\n'))
        self.assertIn(('budget-countdown', 'high'),
                      rules_for('# A\n\nContext window: 45% used.\n'))

    def test_lowercase_incomplete_is_prose(self):
        self.assertNotIn(('threat-language', 'high'), rules_for('# A\n\nAn incomplete migration leaves the table locked.\n'))

    def test_trailing_allow_marker_skips_only_its_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'copy.md'
            path.write_text('# A\n\nKeep the label to at most 3 words. '
                            '<!-- cruft-lint-allow: rendered UI copy, not an instruction cap -->'
                            '\n\nSacrifice grammar for brevity.\n',
                            encoding='utf-8')
            report = lint_cruft.lint_paths([str(path)])
        self.assertEqual(report['files_scanned'], 1)
        self.assertEqual(report['skipped'], [])
        rules = {(f['rule'], f['level']) for f in report['findings']}
        self.assertNotIn(('numeric-cap', 'medium'), rules)
        self.assertIn(('report-compression', 'high'), rules,
                      'A trailing marker must not disable the rest of the file')

    def test_standalone_allow_marker_skips_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'teaching.md'
            path.write_text('<!-- cruft-lint-allow: teaches prompting patterns -->'
                            '\n\n# A\n\nSacrifice grammar for brevity.\n',
                            encoding='utf-8')
            report = lint_cruft.lint_paths([str(path)])
        self.assertEqual(report['findings'], [])
        self.assertEqual(len(report['skipped']), 1)

    def test_dry_principle_is_not_threat_language(self):
        self.assertNotIn(('threat-language', 'high'),
                         rules_for("# A\n\nFollow DRY (Don't Repeat Yourself) when extracting helpers.\n"))

    def test_numeric_cap(self):
        self.assertIn(('numeric-cap', 'medium'), rules_for('# A\n\nAnswer in 3-4 sentences max.\n'))
        self.assertIn(('numeric-cap', 'medium'), rules_for('# A\n\nUse at most 5 bullets.\n'))

    def test_thinking_scaffold_anti_formatting_narration_budget(self):
        text = '# A\n\nThink step by step.\nNever use bullets in replies.\nHold all findings until the end.\nContext nearly full, wrap up.\n'
        found = rules_for(text)
        for rule in ('thinking-scaffold', 'narration-suppressor', 'budget-countdown'):
            self.assertIn((rule, 'high'), found, rule)
        self.assertIn(('anti-formatting', 'medium'), found)

    def test_thinking_keywords_are_scaffolds(self):
        for text in ('# A\n\nultrathink\n',
                     '# A\n\nThink hard about the failure modes.\n',
                     '# A\n\nThink harder before answering.\n',
                     '# A\n\n**Thinking level:** Ultrathink\n'):
            self.assertIn(('thinking-scaffold', 'high'), rules_for(text), text)

    def test_thoroughness_booster(self):
        for text in ('# A\n\nBe thorough and specific about strategy.\n',
                     '# A\n\nResearch thoroughly when uncertain.\n',
                     '# A\n\nExhaustively list every edge case.\n',
                     '# A\n\n**Remember:** Plan quality determines success.\n'):
            self.assertIn(('thoroughness-booster', 'medium'), rules_for(text), text)
        self.assertNotIn(('thoroughness-booster', 'medium'),
                         rules_for('# A\n\nThe review covers each failure class in turn.\n'))

    def test_model_name_conditional(self):
        for text in (
            '# A\n\nOn Claude Fable 5.x and Opus 5 the model already runs the Floor.\n',
            '# A\n\nIf you are on Sonnet, run the full checklist.\n',
            '# A\n\nFor GPT-5.6 you should skip the simulation step.\n',
            '# A\n\nWhen running on Gemini 3, use the shorter prompt.\n',
        ):
            self.assertIn(('model-name-conditional', 'medium'), rules_for(text), text)
        # Naming a model as a dispatch target is configuration, not a behavior
        # gate, so routing and provenance lines must stay clean.
        for text in (
            '# A\n\nRoute the counsel request to Fable 5.\n',
            '# A\n\nCursor maps `fable` to `claude-fable-5-high`.\n',
            '# A\n\nSkip the section when you already spread hypotheses unprompted.\n',
        ):
            self.assertNotIn(('model-name-conditional', 'medium'), rules_for(text), text)

    def test_volatile_fact_and_migration_phrasing(self):
        found = rules_for('# A\n\nThe model has 200K tokens of context.\nThis now works differently and no longer needs X.\n')
        self.assertIn(('volatile-fact', 'medium'), found)
        self.assertIn(('migration-phrasing', 'low'), found)

    def test_python_version_is_not_volatile(self):
        self.assertNotIn(('volatile-fact', 'medium'), rules_for('# A\n\nRequires Python 3.7 or newer.\n'))


class StructuralRuleTests(unittest.TestCase):
    def test_blanket_permission_gates_are_review_signals(self):
        for text in ('Ask for user approval before every step.',
                     'User approval at each major step is required.',
                     'Stop for confirmation after each phase.'):
            self.assertIn(('approval-loop', 'medium'), rules_for(text), text)
        for text in ('Confirm before deleting modified user files.',
                     'In --interactive mode, ask for approval before every step.',
                     'Ask for approval before each destructive operation.'):
            self.assertNotIn(('approval-loop', 'medium'), rules_for(text), text)

    def test_blanket_document_reads_are_review_signals(self):
        for text in ('Read ALL API docs before implementation.',
                     'Read every reference file before starting.',
                     'Read the entire specification before making any edit.'):
            self.assertIn(('blanket-full-read', 'medium'), rules_for(text), text)
        for text in ('Read the auth reference before changing token validation.',
                     'Read the entire OOXML guide because edits must preserve package relationships.',
                     'Read all input records to compute the aggregate.'):
            self.assertNotIn(('blanket-full-read', 'medium'), rules_for(text), text)

    def test_fenced_prompt_scaffolds_have_separate_diagnostics(self):
        for language in ('', 'text', 'markdown', 'md', 'plaintext'):
            doc = lint_cruft.Document(Path('SKILL.md'),
                                      '# Format\n```' + language + '\nThought N/M: ...\n```\n')
            findings = [f for f in lint_cruft.lint_document(doc) if f['rule'] == 'fenced-reasoning']
            self.assertEqual(len(findings), 1, language)
            self.assertEqual(findings[0]['line'], 3)
            self.assertEqual(findings[0]['level'], 'medium')
        for language in ('python', 'bash', 'json'):
            self.assertNotIn(('fenced-reasoning', 'medium'),
                             rules_for('```' + language + '\nThought N/M: ...\n```'))

    def test_fenced_diagnostics_preserve_exemptions_and_nested_fences(self):
        for body in ('<!-- fragile -->\n```text\nThought N/M: ...\n```\n<!-- /fragile -->',
                     '```text\nThought N/M: ... <!-- cruft-lint-allow: exact fixture -->\n```'):
            self.assertNotIn(('fenced-reasoning', 'medium'), rules_for(body))
        body = '````markdown\n```\nThought 1/3: ...\n```\n````\n'
        self.assertIn(('fenced-reasoning', 'medium'), rules_for(body))
        self.assertNotIn(('thinking-scaffold', 'high'), rules_for('```text\n<thinking>\n```'))

    def test_pressure_density_high_within_window(self):
        text = '# A\n\nYou MUST do X.\nNEVER do Y.\nALWAYS do Z.\n'
        found = rules_for(text)
        self.assertIn(('pressure-density', 'high'), found)
        self.assertIn(('emphasis-no-reason', 'medium'), found)

    def test_pressure_with_reason_is_not_counted(self):
        text = '# A\n\nYou MUST run the migration in order because a partial run corrupts the table.\n'
        found = rules_for(text)
        self.assertNotIn(('pressure-density', 'high'), found)
        self.assertNotIn(('emphasis-no-reason', 'medium'), found)

    def test_prohibition_run(self):
        text = '# A\n\n- Do not use tables.\n- Never add headers.\n- Avoid emojis.\n'
        self.assertIn(('prohibition-run', 'medium'), rules_for(text))

    def test_duplicate_line_within_file(self):
        line = 'Run the full validation before packaging the skill for distribution.'
        self.assertIn(('duplicate-line', 'medium'), rules_for(f'# A\n\n{line}\n\nMore.\n\n{line}\n'))

    def test_duplicate_ignores_list_marker_and_emphasis(self):
        line = 'Lead with the outcome and keep the report short by selecting what matters.'
        found = rules_for(f'# A\n\n{line}\n\nMore text here.\n\n- {line}\n')
        self.assertIn(('duplicate-line', 'medium'), found)

    def test_repeated_command_or_reference_row_is_not_a_duplicate(self):
        row = '- `python3 scripts/convert_pdf_to_images.py <file.pdf> <output_dir>`'
        self.assertNotIn(('duplicate-line', 'medium'), rules_for(f'# A\n\n{row}\n\nMore.\n\n{row}\n'))
        link = '- See [`docs/operations/implementation-smoke.md`](../../docs/operations/implementation-smoke.md)'
        self.assertNotIn(('duplicate-line', 'medium'), rules_for(f'# A\n\n{link}\n\nMore.\n\n{link}\n'))

    def test_step_choreography(self):
        text = '# A\n\n' + ''.join(f'## Step {i}: thing\n\ntext\n\n' for i in range(1, 6))
        self.assertIn(('step-choreography', 'low'), rules_for(text))
        self.assertNotIn(('step-choreography', 'low'), rules_for(text + 'These steps are ordered because each consumes the previous output.\n'))

    def test_identity_stub(self):
        self.assertIn(('identity-stub', 'low'), rules_for('You are an expert assistant.\n\nDo things.\n'))
        self.assertNotIn(('identity-stub', 'low'), rules_for('You are an expert reviewer for the payments team.\n\nThe product is a checkout API.\n'))


class VerificationRitualTests(unittest.TestCase):
    def test_generic_repeated_checks_are_advisory(self):
        for line in ('Double-check your work. Verify twice before responding.',
                     '- Always verify your work twice.',
                     '**Double check everything before finishing.**'):
            self.assertIn(('verification-ritual', 'low'), rules_for('# Skill\n\n' + line), line)

    def test_conditional_and_concrete_verification_stays_clean(self):
        for line in ('If validation fails, double-check your work.',
                     'Verify twice before responding if the first check fails.',
                     'After a checksum mismatch:\nDouble-check your work.',
                     'Double-check your work\nif the checksum differs.',
                     'Because deletion is irreversible:\nDouble-check your work.',
                     'Verify the backup checksum twice before deleting the original.',
                     'Double-check the payment recipient before sending funds.',
                     'Run tests again when new failures or changes justify it.',
                     'Verify the generated artifact against the acceptance criteria.'):
            self.assertNotIn(('verification-ritual', 'low'), rules_for('# Skill\n\n' + line), line)

    def test_quoted_examples_fences_and_fragile_contracts_stay_clean(self):
        for line in ('> Double-check your work.',
                     'Avoid "Double-check your work. Verify twice before responding."',
                     '"Double-check your work."',
                     '`Double-check your work.`',
                     '```text\nDouble-check your work.\n```',
                     '<!-- fragile -->\nDouble-check your work.\n<!-- /fragile -->',
                     'Double-check your work. cruft-lint-allow',
                     '| Double-check your work. | Example |'):
            self.assertNotIn(('verification-ritual', 'low'), rules_for('# Skill\n\n' + line), line)


class RoutingTests(unittest.TestCase):
    def lint(self, metadata, body='# Skill\n', routing=True):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'SKILL.md'
            path.write_text(f'---\nname: example\n{metadata}\n---\n{body}', encoding='utf-8')
            return lint_cruft.lint_paths([str(path)], routing=routing)['findings']

    def test_routing_is_opt_in_and_separate_from_body_pressure(self):
        metadata = 'description: "Always use this skill."'
        self.assertEqual(self.lint(metadata, routing=False), [])
        findings = self.lint(metadata)
        self.assertEqual([(f['rule'], f['level']) for f in findings], [('routing-pressure', 'low')])
        self.assertEqual(findings[0]['line'], 1)
        self.assertEqual(self.lint('description: "CRITICAL IMPORTANT MUST NEVER"'), [])

    def test_plain_quoted_and_folded_scalars_are_decoded(self):
        for metadata in ('description: Always use this skill.',
                         'description: "Always use this skill."',
                         "description: 'Always use this skill.'",
                         'description: >-\n  Always use\n  this skill.',
                         'description: "Always use this skill, even when unrelated."',
                         'description: "Never skip this skill."',
                         'when_to_use: "You must use this skill for every task."'):
            self.assertIn('routing-pressure', [f['rule'] for f in self.lint(metadata)], metadata)

    def test_generic_mentions_and_keyword_lists_are_advisory(self):
        for metadata in ('description: "Use this skill whenever the user mentions data, numbers, files, or analysis."',
                         'keywords: [data, numbers, files, analysis]',
                         'keywords:\n  - data\n  - numbers\n  - files\n  - analysis'):
            findings = self.lint(metadata)
            self.assertEqual([(f['rule'], f['level']) for f in findings], [('routing-keyword-scope', 'low')])

    def test_precise_whenever_and_descriptive_task_language_stay_clean(self):
        for metadata in ('description: "Use this skill whenever the user asks to parse CSV files."',
                         'description: "Always use this skill when authoring SKILL.md resources."',
                         'description: "Analyze data and numbers in CSV files for financial analysis."',
                         'description: "Use when validating every file in a package."',
                         'description: "Do not use this skill for every task."',
                         'keywords: [csv, parsing, files, analysis]',
                         'metadata:\n  description: "Always use this skill."'):
            self.assertEqual(self.lint(metadata), [], metadata)

    def test_literal_block_examples_and_markers_are_preserved(self):
        for example in ('> Always use this skill.', '"Always use this skill."',
                        '```text\nAlways use this skill.\n```',
                        '<!-- fragile -->\nAlways use this skill.\n<!-- /fragile -->',
                        'Always use this skill. cruft-lint-allow'):
            metadata = 'description: |\n' + '\n'.join('  ' + line for line in example.splitlines())
            self.assertEqual(self.lint(metadata), [], metadata)

    def test_invalid_yaml_and_routing_types_are_explicit(self):
        for metadata in ('description: [', 'description: x\ndescription: y',
                         'description: true', 'when_to_use: [files]',
                         'keywords: data', 'keywords: [123]'):
            findings = self.lint(metadata)
            self.assertEqual([(f['rule'], f['level']) for f in findings], [('routing-metadata-format', 'high')])

    def test_missing_dependency_only_blocks_requested_routing(self):
        real_import = builtins.__import__

        def without_yaml(name, *args, **kwargs):
            if name == 'yaml':
                raise ImportError("No module named 'yaml'")
            return real_import(name, *args, **kwargs)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'SKILL.md'
            path.write_text('---\nname: x\ndescription: Fine.\n---\n# Skill\n', encoding='utf-8')
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch('builtins.__import__', side_effect=without_yaml), redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(lint_cruft.main([str(path), '--json']), 0)
                self.assertEqual(lint_cruft.main([str(path), '--routing', '--json']), 3)
            self.assertEqual(json.loads(stdout.getvalue())['findings'], [])
            self.assertIn('PyYAML is not installed', stderr.getvalue())

    def test_routing_cli_advisories_do_not_fail_default_threshold(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'SKILL.md'
            path.write_text('---\ndescription: Always use this skill.\n---\n', encoding='utf-8')
            with redirect_stdout(io.StringIO()):
                self.assertEqual(lint_cruft.main([str(path), '--routing']), 0)
                self.assertEqual(lint_cruft.main([str(path), '--routing', '--fail-on', 'low']), 1)
            path.write_text('---\ndescription: [\n---\n', encoding='utf-8')
            with redirect_stdout(io.StringIO()):
                self.assertEqual(lint_cruft.main([str(path), '--routing']), 1)


class SkipTests(unittest.TestCase):
    def test_frontmatter_fences_and_fragile_blocks_are_skipped(self):
        text = (
            '---\ndescription: "CRITICAL: use this skill ALWAYS, NEVER skip it, IMPORTANT"\n---\n'
            '# A\n\n```\nYou MUST NEVER ALWAYS sacrifice grammar\n```\n'
            '<!-- fragile -->\nrm -rf build  # MUST run first, NEVER skip\n<!-- /fragile -->\n'
            'Sacrifice grammar here. cruft-lint-allow\n'
        )
        self.assertEqual(rules_for(text), set())

    def test_nested_fence_does_not_end_the_outer_block(self):
        text = ('# A\n\n````markdown\n'
                'Sacrifice grammar for brevity.\n'
                '```\nliteral prompt\n```\n'
                'DO NOT do this yourself - DELEGATE.\n'
                '````\n\nSacrifice grammar for brevity.\n')
        found = rules_for(text)
        self.assertIn(('report-compression', 'high'), found)
        self.assertNotIn(('threat-language', 'high'), found)

    def test_file_allow_marker_skips_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'teaching.md'
            path.write_text('<!-- cruft-lint-allow: teaching -->\nSacrifice grammar.\n', encoding='utf-8')
            report = lint_cruft.lint_paths([tmp])
        self.assertEqual(report['files_scanned'], 0)
        self.assertEqual(report['skipped'][0]['reason'], 'cruft-lint-allow')

    def test_dot_directory_above_the_root_is_still_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / '.claude' / 'skills' / 'demo'
            root.mkdir(parents=True)
            (root / 'SKILL.md').write_text('# A\n\nSacrifice grammar for brevity.\n', encoding='utf-8')
            report = lint_cruft.lint_paths([str(root)])
        self.assertEqual(report['files_scanned'], 1, report)
        self.assertIn('report-compression', [f['rule'] for f in report['findings']], report)

    def test_dot_directory_below_the_root_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / '.command-archive'
            archive.mkdir()
            (archive / 'retired.md').write_text('# A\n\nSacrifice grammar for brevity.\n', encoding='utf-8')
            report = lint_cruft.lint_paths([tmp])
        self.assertEqual(report['files_scanned'], 0, report)
        self.assertEqual(report['findings'], [])

    def test_non_hook_scripts_are_not_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'scripts').mkdir()
            (Path(tmp) / 'scripts' / 'report.cjs').write_text("console.log('Tokens remaining: 5');\n", encoding='utf-8')
            (Path(tmp) / 'hooks').mkdir()
            (Path(tmp) / 'hooks' / 'inject.cjs').write_text("const s = 'Context nearly full';\n", encoding='utf-8')
            report = lint_cruft.lint_paths([tmp])
        self.assertEqual([f['file'].split('/')[-1] for f in report['findings']], ['inject.cjs'])

    def test_scripts_only_get_text_rules(self):
        text = "const s = 'Sacrifice grammar for concision';\nconst t = 'You MUST NEVER ALWAYS';\n"
        found = rules_for(text, name='hook.cjs')
        self.assertIn(('report-compression', 'high'), found)
        self.assertNotIn(('pressure-density', 'high'), found)


class CrossFileTests(unittest.TestCase):
    def test_boilerplate_across_files_is_opt_in_and_low(self):
        line = 'This boilerplate sentence is shared verbatim across many agent prompt files in the kit.'
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(5):
                (Path(tmp) / f'a{i}.md').write_text(f'# A{i}\n\n{line}\n', encoding='utf-8')
            default = lint_cruft.lint_paths([tmp])
            opted_in = lint_cruft.lint_paths([tmp], cross_file=True)
        self.assertEqual([f for f in default['findings'] if 'boilerplate' in f['message']], [],
                         'Files load into separate contexts, so shared text is not duplication by default')
        boiler = [f for f in opted_in['findings'] if 'boilerplate' in f['message']]
        self.assertEqual(len(boiler), 5)
        self.assertTrue(all(f['level'] == 'low' for f in boiler), boiler)

    def test_main_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'clean.md').write_text('# Clean\n\nState the outcome and how to verify it.\n', encoding='utf-8')
            self.assertEqual(lint_cruft.main([tmp]), 0)
            (Path(tmp) / 'dirty.md').write_text('# Dirty\n\nSacrifice grammar.\n', encoding='utf-8')
            self.assertEqual(lint_cruft.main([tmp]), 1)
            self.assertEqual(lint_cruft.main([tmp, '--fail-on', 'none']), 0)


if __name__ == '__main__':
    unittest.main()

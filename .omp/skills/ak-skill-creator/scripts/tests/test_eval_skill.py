import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import eval_skill
from eval_contract import validate_cases, validate_observations, validate_record, skill_digest


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.case = {'id': 'one', 'split': 'holdout', 'prompt': 'Normalize fictional rows.',
                     'expected_output': 'A JSON array of row ids.', 'files': [], 'assertions': [
                         {'id': 'rows', 'text': 'All row ids preserved.', 'kind': 'json-equals',
                          'path': 'result.json', 'expected': ['a', 'b']}]}

    def record(self, status='completed', passed=True):
        return {'run_id': 'r1', 'case_id': 'one', 'split': 'holdout', 'variant': 'without_skill',
                'model': 'observed-model', 'runtime': 'observed-runtime', 'status': status,
                'skill_sha256': None, 'checks': [{'id': 'rows', 'passed': passed, 'evidence': 'Artifact checked'}],
                'tokens': None}

    def observations(self):
        return {'effective_effort': 'medium', 'cache_state': 'cold',
                'fingerprints': dict.fromkeys(('configuration', 'cases', 'tools', 'catalog'), 'sha256:observed'),
                'usage': {'input_tokens': 40, 'output_tokens': 10, 'cache_read_tokens': 0,
                          'cache_write_tokens': 20, 'source': 'runner receipt',
                          'semantics': 'input excludes cache reads; writes are a subset of input'},
                'cost': {'amount': 0.01, 'currency': 'USD', 'source': 'provider receipt',
                         'pricing_date': '2026-09-12'},
                'loaded_references': ['references/domain.md']}

    def cli_grade(self, observations=None, extra=()):
        cases = self.root / 'cases.json'
        cases.write_text(json.dumps({'skill_name': 'x', 'evals': [self.case]}))
        (self.root / 'result.json').write_text('["a","b"]')
        args = ['grade', str(cases), '--case-id', 'one', '--outputs', str(self.root),
                '--run-id', 'r', '--variant', 'without_skill', '--model', 'm', '--runtime', 'r']
        if observations is not None:
            evidence = self.root / 'observations.json'
            evidence.write_text(json.dumps(observations))
            args.extend(['--observations', str(evidence)])
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = eval_skill.main(args + list(extra))
        return code, json.loads(stream.getvalue())

    def test_rejects_invalid_and_duplicate_cases(self):
        with self.assertRaises(ValueError):
            validate_cases({'skill_name': 'x', 'evals': [self.case, self.case]})
        self.case['assertions'][0]['kind'] = 'invented'
        with self.assertRaises(ValueError):
            validate_cases({'skill_name': 'x', 'evals': [self.case]})

    def test_grades_actual_json_not_claims(self):
        output = self.root / 'result.json'
        output.write_text('["a","b"]')
        self.assertTrue(eval_skill.grade(self.case, self.root)[0]['passed'])
        output.write_text('["a"]')
        self.assertFalse(eval_skill.grade(self.case, self.root)[0]['passed'])
        output.write_text('not json')
        self.assertFalse(eval_skill.grade(self.case, self.root)[0]['passed'])

    def test_missing_artifact_and_escape_fail(self):
        self.assertFalse(eval_skill.grade(self.case, self.root)[0]['passed'])

    def test_ambiguous_json_and_boolean_number_confusion_fail(self):
        output = self.root / 'result.json'
        for text in ('{"a":1,"a":2}', '[NaN]', '[true]'):
            output.write_text(text)
            self.case['assertions'][0]['expected'] = [1]
            self.assertFalse(eval_skill.grade(self.case, self.root)[0]['passed'])
        self.case['assertions'][0]['path'] = '../outside.json'
        self.assertFalse(eval_skill.grade(self.case, self.root)[0]['passed'])

    def test_rubric_stays_ungraded(self):
        self.case['assertions'] = [{'id': 'quality', 'text': 'The explanation is usable.'}]
        self.assertIsNone(eval_skill.grade(self.case, self.root)[0]['passed'])

    def test_incomplete_record_and_invalid_kind_return_validation_errors(self):
        for missing in ('skill_sha256', 'passed'):
            record = self.record()
            del (record if missing == 'skill_sha256' else record['checks'][0])[missing]
            with self.assertRaises(ValueError):
                eval_skill.summarize([record])
        self.case['assertions'][0]['kind'] = []
        with self.assertRaises(ValueError):
            validate_cases({'skill_name': 'x', 'evals': [self.case]})

    def test_artifact_directory_symlink_fails_even_inside_root(self):
        actual = self.root / 'actual'
        actual.mkdir()
        (actual / 'result.json').write_text('["a","b"]')
        try:
            (self.root / 'linked').symlink_to(actual, target_is_directory=True)
        except OSError:
            self.skipTest('Directory symlinks unavailable for this account')
        self.case['assertions'][0]['path'] = 'linked/result.json'
        self.assertFalse(eval_skill.grade(self.case, self.root)[0]['passed'])

    def test_blocked_and_ungraded_are_not_pass(self):
        records = [self.record(), self.record('blocked'), self.record(passed=None)]
        for i, record in enumerate(records):
            record['run_id'] = f'r{i}'
        group = eval_skill.summarize(records)['groups'][0]
        self.assertEqual((group['passed'], group['runs'], group['blocked']), (1, 3, 1))
        self.assertIsNone(group['metrics']['tokens']['mean'])

    def test_duplicate_runs_and_fabricated_metrics_rejected(self):
        with self.assertRaises(ValueError):
            eval_skill.summarize([self.record(), self.record()])
        for value in (-1, float('nan'), True):
            record = self.record()
            record['tokens'] = value
            with self.assertRaises(ValueError):
                validate_record(record)

    def test_groups_models_runtimes_splits_and_versions_separately(self):
        records = []
        for key, value in (('model', 'other'), ('runtime', 'other'), ('split', 'train'), ('variant', 'candidate')):
            record = self.record()
            record.update({key: value, 'run_id': key})
            if key == 'variant':
                record['skill_sha256'] = 'a' * 64
            records.append(record)
        self.assertEqual(len(eval_skill.summarize(records)['groups']), 4)

    def test_snapshot_hash_tracks_resource_bytes(self):
        (self.root / 'SKILL.md').write_text('# Fictional skill')
        before = skill_digest(self.root)
        (self.root / 'helper.txt').write_text('new domain rule')
        self.assertNotEqual(before, skill_digest(self.root))

    def test_cli_missing_case_fails_as_json(self):
        cases = self.root / 'cases.json'
        cases.write_text(json.dumps({'skill_name': 'x', 'evals': [self.case]}))
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = eval_skill.main(['grade', str(cases), '--case-id', 'absent', '--outputs', str(self.root),
                                    '--run-id', 'r', '--variant', 'without_skill', '--model', 'm', '--runtime', 'r'])
        self.assertEqual(code, 2)
        self.assertIn('Unknown case', json.loads(stream.getvalue())['error'])

    def test_cli_imports_observations_without_changing_legacy_metrics(self):
        code, record = self.cli_grade(self.observations(), ['--tokens', '71'])
        self.assertEqual(code, 0)
        self.assertEqual(record['observations'], self.observations())
        self.assertEqual(record['tokens'], 71)
        self.assertTrue(record['checks'][0]['passed'])
        self.assertEqual(record['run_id'], 'r')
        code, legacy = self.cli_grade(extra=['--duration-ms', '100'])
        self.assertEqual(code, 0)
        self.assertNotIn('observations', legacy)
        self.assertEqual(legacy['duration_ms'], 100)
        group = eval_skill.summarize([legacy])['groups'][0]
        self.assertFalse(group['comparison_ready'])
        self.assertIn('effective_effort', group['missing_evidence'])

    def test_import_cannot_override_identity_or_verdicts(self):
        for key, value in (('run_id', 'fake'), ('status', 'completed'), ('checks', []),
                           ('tokens', 0), ('model', 'different')):
            code, result = self.cli_grade({key: value})
            self.assertEqual(code, 2)
            self.assertIn('unsupported fields', result['error'])

    def test_rejects_wrong_observation_types_and_unknown_fields(self):
        invalid = [[], {'effective_effort': True}, {'effective_effort': ''}, {'cache_state': []},
                   {'cache_state': 'unknown'}, {'fingerprints': []}, {'fingerprints': {'cases': 1}},
                   {'usage': {'source': []}}, {'usage': {'semantics': False}}, {'usage': {'extra': 1}},
                   {'cost': {'amount': True}}, {'cost': {'currency': 5}},
                   {'cost': {'pricing_date': '2026-02-30'}}, {'cost': {'pricing_date': '20260912'}},
                   {'loaded_references': 'reference.md'}, {'loaded_references': [None]},
                   {'loaded_references': ['a', 'a']}]
        for value in (-1, True, '10', float('nan'), float('inf')):
            invalid.extend([{'usage': {'input_tokens': value}}, {'cost': {'amount': value}}])
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_observations(value)

    def test_cli_invalid_import_is_json_error(self):
        for value in ([], {'usage': {'input_tokens': float('inf')}}, {'cost': {'amount': -1}}):
            with self.subTest(value=value):
                code, result = self.cli_grade(value)
                self.assertEqual(code, 2)
                self.assertIn('error', result)

    def test_rejects_contradictory_cache_but_does_not_infer_token_totals(self):
        for state, metric in (('cold', 'cache_read_tokens'), ('disabled', 'cache_read_tokens'),
                              ('disabled', 'cache_write_tokens')):
            with self.subTest(state=state, metric=metric), self.assertRaises(ValueError):
                validate_observations({'cache_state': state, 'usage': {metric: 1}})
        # A runner's input/cache relationship is provider-specific, not universal arithmetic.
        evidence = {'cache_state': 'warm', 'usage': {'input_tokens': 1, 'cache_read_tokens': 100}}
        self.assertEqual(validate_observations(evidence)['usage']['cache_read_tokens'], 100)

    def test_grouping_separates_observed_conditions_and_provenance(self):
        first = self.record()
        first['observations'] = self.observations()
        changes = [(('effective_effort',), 'high'), (('cache_state',), 'warm')]
        changes += [(('fingerprints', key), 'different') for key in first['observations']['fingerprints']]
        changes += [(('usage', key), 'different') for key in ('source', 'semantics')]
        changes += [(('cost', 'currency'), 'EUR'), (('cost', 'source'), 'different'),
                    (('cost', 'pricing_date'), '2026-09-11')]
        for path, value in changes:
            other = copy.deepcopy(first)
            other['run_id'] = 'other'
            target = other['observations']
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path):
                self.assertEqual(len(eval_skill.summarize([first, other])['groups']), 2)
        other = copy.deepcopy(first)
        other['run_id'] = 'other'
        other['observations']['cost']['amount'] = 0.03
        group = eval_skill.summarize([first, other])['groups'][0]
        self.assertTrue(group['comparison_ready'])
        self.assertEqual(group['runs'], 2)
        self.assertAlmostEqual(group['metrics']['cost.amount']['mean'], 0.02)

    def test_unknown_metrics_remain_null_and_partial_provenance_is_not_pooled(self):
        first = self.record()
        first['observations'] = {'usage': {'input_tokens': 20}, 'cost': {'amount': 0.01}}
        other = copy.deepcopy(first)
        other['run_id'] = 'other'
        groups = eval_skill.summarize([first, other])['groups']
        self.assertEqual(len(groups), 2)
        for group in groups:
            self.assertFalse(group['comparison_ready'])
            self.assertIn('usage.source', group['missing_evidence'])
            self.assertIn('cost.pricing_date', group['missing_evidence'])
            self.assertEqual(group['metrics']['usage.output_tokens'], {'measured_runs': 0, 'mean': None})
        normalized = validate_observations({})
        self.assertIsNone(normalized['cost']['amount'])
        self.assertIsNone(normalized['loaded_references'])

    def test_summary_preserves_reference_reads_as_per_run_outcomes(self):
        first = self.record()
        first['observations'] = self.observations()
        other = copy.deepcopy(first)
        other['run_id'] = 'r2'
        other['observations']['loaded_references'] = []
        groups = eval_skill.summarize([other, first])['groups']
        # Reads are execution outcomes, not assigned comparison conditions.
        self.assertEqual(len(groups), 1)
        self.assertTrue(groups[0]['comparison_ready'])
        self.assertEqual(groups[0]['observed_runs'], [
            {'run_id': 'r1', 'loaded_references': ['references/domain.md']},
            {'run_id': 'r2', 'loaded_references': []}])
        legacy = eval_skill.summarize([self.record()])['groups'][0]
        self.assertEqual(legacy['observed_runs'], [{'run_id': 'r1', 'loaded_references': None}])

    def test_summary_validates_imported_records_too(self):
        record = self.record()
        record['observations'] = {'usage': {'cache_read_tokens': -1}}
        with self.assertRaises(ValueError):
            eval_skill.summarize([record])

    def test_summarize_cli_reads_legacy_and_observed_records(self):
        _, legacy = self.cli_grade()
        _, observed = self.cli_grade(self.observations())
        observed['run_id'] = 'observed'
        paths = []
        for record in (legacy, observed):
            path = self.root / f'{record["run_id"]}.json'
            path.write_text(json.dumps(record))
            paths.append(str(path))
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = eval_skill.main(['summarize', *paths])
        self.assertEqual(code, 0)
        groups = json.loads(stream.getvalue())['groups']
        self.assertEqual(len(groups), 2)
        self.assertEqual(sum(group['comparison_ready'] for group in groups), 1)

    def test_large_finite_integer_is_not_coerced_to_float(self):
        large = 10 ** 400
        evidence = validate_observations({'usage': {'input_tokens': large}, 'loaded_references': []})
        self.assertEqual(evidence['usage']['input_tokens'], large)
        self.assertEqual(evidence['loaded_references'], [])


if __name__ == '__main__':
    unittest.main()

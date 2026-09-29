#!/usr/bin/env python3
"""Validate cases, grade real artifacts, and summarize evidence; never invokes a model."""

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

from eval_contract import (USAGE_METRICS, load_json, observation_context, require, skill_digest,
                           validate_cases, validate_observations, validate_record)


def grade(case, outputs):
    root = Path(outputs).resolve()
    require(root.is_dir(), 'Output directory does not exist')
    checks = []
    for assertion in case['assertions']:
        kind = assertion.get('kind', 'rubric')
        check = {'id': assertion['id'], 'passed': None, 'evidence': 'Not graded: needs independent rubric review'}
        if kind != 'rubric':
            path = root / assertion['path']
            try:
                path.resolve().relative_to(root)
                require(not any(part.is_symlink() for part in (path, *path.parents) if part != root and root in part.parents),
                        'Artifact symlinks are not accepted')
                passed = path.is_file()
                if passed and kind == 'json-equals':
                    passed = json.dumps(load_json(path), sort_keys=True) == json.dumps(assertion['expected'], sort_keys=True)
                if passed and kind == 'text-contains':
                    passed = assertion['expected'] in path.read_text(encoding='utf-8')
                check.update(passed=passed, evidence=f'{kind}: {assertion["path"]}: {"pass" if passed else "fail"}')
            except (OSError, ValueError, RuntimeError) as exc:
                check.update(passed=False, evidence=f'{kind}: {assertion["path"]}: {type(exc).__name__}')
        checks.append(check)
    return checks


def summarize(records):
    groups = defaultdict(list)
    seen = set()
    for record in records:
        validate_record(record)
        require(record['run_id'] not in seen, 'Duplicate run_id')
        seen.add(record['run_id'])
        key = (record['variant'], record['model'], record['runtime'], record['split'], record['skill_sha256'])
        _, context, missing = observation_context(record.get('observations'))
        # Keep legacy grouping readable, but never pool partially observed new runs.
        isolation = record['run_id'] if record.get('observations') is not None and missing else None
        key += (json.dumps(context, sort_keys=True), isolation)
        groups[key].append(record)
    result = []
    for key, runs in sorted(groups.items(), key=lambda item: str(item[0])):
        passed = sum(r['status'] == 'completed' and bool(r['checks']) and all(c['passed'] is True for c in r['checks']) for r in runs)
        metrics = {}
        for metric in ('tokens', 'duration_ms', 'tool_calls', 'corrections'):
            measured = [r[metric] for r in runs if r.get(metric) is not None]
            metrics[metric] = {'measured_runs': len(measured), 'mean': statistics.mean(measured) if measured else None}
        observations = [observation_context(r.get('observations')) for r in runs]
        for section, metric in [('usage', metric) for metric in USAGE_METRICS] + [('cost', 'amount')]:
            measured = [o[0][section][metric] for o in observations if o[0][section][metric] is not None]
            metrics[f'{section}.{metric}'] = {'measured_runs': len(measured),
                                             'mean': statistics.mean(measured) if measured else None}
        missing = sorted({field for o in observations for field in o[2]})
        result.append(dict(zip(('variant', 'model', 'runtime', 'split', 'skill_sha256'), key[:5]),
                           runs=len(runs), case_ids=sorted({r["case_id"] for r in runs}), passed=passed, pass_rate=passed / len(runs),
                           blocked=sum(r['status'] == 'blocked' for r in runs),
                           failed=sum(r['status'] == 'failed' for r in runs), metrics=metrics,
                           comparison_context=observations[0][1], missing_evidence=missing,
                           comparison_ready=not missing, run_ids=sorted(r['run_id'] for r in runs),
                           observed_runs=sorted(({'run_id': r['run_id'],
                                                 'loaded_references': o[0]['loaded_references']}
                                                for r, o in zip(runs, observations)), key=lambda r: r['run_id'])))
    return {'groups': result, 'note': 'Compare matched case sets and configurations; small samples do not establish generalization. '
            'Different observed conditions are separate groups. Missing evidence prevents effort/cache/cost conclusions; '
            'legacy groups retain their original grouping and partially observed runs are isolated.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    validate = sub.add_parser('validate')
    validate.add_argument('cases')
    grading = sub.add_parser('grade')
    grading.add_argument('cases')
    grading.add_argument('--case-id', required=True)
    grading.add_argument('--outputs', required=True)
    grading.add_argument('--run-id', required=True)
    grading.add_argument('--variant', required=True)
    grading.add_argument('--model', required=True)
    grading.add_argument('--runtime', required=True)
    grading.add_argument('--skill')
    grading.add_argument('--observations', help='JSON object containing observed configuration, usage and cost evidence')
    grading.add_argument('--status', choices=('completed', 'blocked', 'failed'), default='completed')
    for field in ('tokens', 'duration-ms', 'tool-calls', 'corrections'):
        grading.add_argument('--' + field, type=float)
    summary = sub.add_parser('summarize')
    summary.add_argument('records', nargs='+')
    args = parser.parse_args(argv)
    try:
        if args.command == 'summarize':
            result = summarize([load_json(path) for path in args.records])
        else:
            cases = validate_cases(load_json(args.cases))
            result = {'valid': True, 'cases': len(cases)}
            if args.command == 'grade':
                case = next((case for case in cases if str(case['id']) == args.case_id), None)
                require(case is not None, 'Unknown case id')
                result = {key: getattr(args, key) for key in ('run_id', 'variant', 'model', 'runtime', 'status', 'tokens', 'duration_ms', 'tool_calls', 'corrections')}
                result.update(case_id=str(case['id']), split=case['split'],
                              skill_sha256=skill_digest(args.skill) if args.skill else None,
                              checks=grade(case, args.outputs) if args.status == 'completed' else [])
                if args.observations:
                    result['observations'] = validate_observations(load_json(args.observations))
                validate_record(result)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.command == 'grade':
            return 0 if result['status'] == 'completed' and all(c['passed'] is True for c in result['checks']) else 1
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(json.dumps({'error': str(exc)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

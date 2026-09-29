"""Small, provider-neutral contracts for cases and observed evaluation records."""

import hashlib
import json
import math
from datetime import date
from pathlib import Path

CHECKS = {'file-exists', 'json-equals', 'text-contains', 'rubric'}
USAGE_METRICS = ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens')
FINGERPRINTS = ('configuration', 'cases', 'tools', 'catalog')


def load_json(path):
    def invalid_constant(_value):
        raise ValueError('Non-finite numbers are not valid JSON evidence')

    def finite_float(value):
        number = float(value)
        require(math.isfinite(number), 'Non-finite numbers are not valid JSON evidence')
        return number

    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate key in JSON evidence')
            result[key] = value
        return result

    with Path(path).open(encoding='utf-8') as handle:
        return json.load(handle, parse_constant=invalid_constant, parse_float=finite_float, object_pairs_hook=unique_keys)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def nonnegative_number(value):
    return (type(value) is int or (type(value) is float and math.isfinite(value))) and value >= 0


def validate_observations(data):
    """Validate an explicit import allowlist and normalize unobserved fields to null."""
    def fields(value, allowed, label):
        require(isinstance(value, dict), f'{label} must be an object')
        require(not (value.keys() - set(allowed)), f'{label} contains unsupported fields')
        return {key: value.get(key) for key in allowed}

    def text(value, label):
        require(value is None or (isinstance(value, str) and bool(value.strip())),
                f'{label} must be non-empty text or null')

    result = fields(data, ('effective_effort', 'cache_state', 'fingerprints', 'usage',
                           'cost', 'loaded_references'), 'observations')
    text(result['effective_effort'], 'effective_effort')
    require(result['cache_state'] is None or
            (isinstance(result['cache_state'], str) and result['cache_state'] in ('cold', 'warm', 'disabled')),
            'cache_state must be cold, warm, disabled or null')
    for name, allowed in (('fingerprints', FINGERPRINTS),
                          ('usage', (*USAGE_METRICS, 'source', 'semantics')),
                          ('cost', ('amount', 'currency', 'source', 'pricing_date'))):
        value = result[name]
        result[name] = fields({} if value is None else value, allowed, name)
        for key, value in result[name].items():
            if key in USAGE_METRICS or key == 'amount':
                require(value is None or nonnegative_number(value),
                        f'{name}.{key} must be finite nonnegative numeric evidence or null')
            else:
                text(value, f'{name}.{key}')
    pricing_date = result['cost']['pricing_date']
    if pricing_date is not None:
        require(date.fromisoformat(pricing_date).isoformat() == pricing_date,
                'cost.pricing_date must be YYYY-MM-DD')
    references = result['loaded_references']
    require(references is None or (isinstance(references, list) and
            all(isinstance(item, str) and item.strip() for item in references)),
            'loaded_references must be a list of non-empty paths or null')
    if references is not None:
        require(len(references) == len(set(references)), 'loaded_references must not contain duplicates')
    if result['cache_state'] in ('cold', 'disabled'):
        require(not result['usage']['cache_read_tokens'], 'Cold or disabled cache cannot report cached reads')
    if result['cache_state'] == 'disabled':
        require(not result['usage']['cache_write_tokens'], 'Disabled cache cannot report cache writes')
    return result


def observation_context(data):
    """Describe comparison conditions without deriving provider-specific usage totals."""
    observed = validate_observations({} if data is None else data)
    context = {key: observed[key] for key in ('effective_effort', 'cache_state', 'fingerprints')}
    context['usage'] = {key: observed['usage'][key] for key in ('source', 'semantics')}
    context['cost'] = {key: observed['cost'][key] for key in ('currency', 'source', 'pricing_date')}
    missing = []
    for key, value in context.items():
        if isinstance(value, dict):
            missing.extend(f'{key}.{field}' for field, item in value.items() if item is None)
        elif value is None:
            missing.append(key)
    missing.extend(f'usage.{key}' for key in USAGE_METRICS if observed['usage'][key] is None)
    if observed['cost']['amount'] is None:
        missing.append('cost.amount')
    if observed['loaded_references'] is None:
        missing.append('loaded_references')
    return observed, context, missing


def validate_cases(data):
    require(isinstance(data, dict), 'Cases must be an object')
    require(isinstance(data.get('skill_name'), str) and data['skill_name'].strip(), 'skill_name is required')
    cases = data.get('evals')
    require(isinstance(cases, list) and cases, 'evals must contain at least one case')
    seen = set()
    for case in cases:
        require(isinstance(case, dict), 'Each case must be an object')
        identifier = case.get('id')
        require(type(identifier) in (str, int) and bool(str(identifier)) and str(identifier) not in seen, 'Case ids must be unique strings or integers')
        seen.add(str(identifier))
        for key in ('prompt', 'expected_output'):
            require(isinstance(case.get(key), str) and case[key].strip(), f'{identifier}: {key} is required')
        require(case.get('split') in ('train', 'holdout'), f'{identifier}: split must be train or holdout')
        require(isinstance(case.get('files', []), list) and all(isinstance(p, str) for p in case.get('files', [])), 'files must be paths')
        assertions = case.get('assertions')
        require(isinstance(assertions, list) and assertions, f'{identifier}: assertions are required')
        ids = set()
        for assertion in assertions:
            require(isinstance(assertion, dict), 'Assertions must be objects')
            aid = assertion.get('id')
            require(isinstance(aid, str) and aid and aid not in ids, 'Assertion ids must be unique')
            ids.add(aid)
            require(isinstance(assertion.get('text'), str) and assertion['text'].strip(), f'{aid}: text is required')
            kind = assertion.get('kind', 'rubric')
            require(isinstance(kind, str) and kind in CHECKS, f'{aid}: unsupported assertion kind')
            if kind != 'rubric':
                require(isinstance(assertion.get('path'), str) and assertion['path'], f'{aid}: path is required')
            if kind in ('json-equals', 'text-contains'):
                require('expected' in assertion, f'{aid}: expected is required')
            if kind == 'text-contains':
                require(isinstance(assertion['expected'], str), f'{aid}: expected must be text')
    return cases


def skill_digest(path):
    """Hash the actual contained skill snapshot, independent of its directory name."""
    root = Path(path).resolve()
    require((root / 'SKILL.md').is_file(), 'Skill snapshot needs SKILL.md')
    digest = hashlib.sha256()
    for file in sorted(root.rglob('*')):
        require(not file.is_symlink(), 'Snapshot contains a symlink')
        if file.is_file() and '__pycache__' not in file.parts:
            digest.update(file.relative_to(root).as_posix().encode() + b'\0')
            digest.update(file.read_bytes() + b'\0')
    return digest.hexdigest()


def validate_record(record):
    require(isinstance(record, dict), 'Record must be an object')
    for key in ('run_id', 'case_id', 'variant', 'model', 'runtime'):
        require(isinstance(record.get(key), str) and record[key].strip(), f'{key} is required')
    require(record.get('split') in ('train', 'holdout'), 'Record needs split')
    require(record.get('status') in ('completed', 'blocked', 'failed'), 'Invalid run status')
    require('skill_sha256' in record, 'Record needs skill_sha256 (null for without_skill)')
    digest = record.get('skill_sha256')
    require(digest is None or (isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest)), 'Invalid skill hash')
    require(record['variant'] == 'without_skill' or digest is not None, 'Skill variants need a snapshot hash')
    require(record['variant'] != 'without_skill' or digest is None, 'No-skill baseline cannot carry a skill snapshot')
    for key in ('tokens', 'duration_ms', 'tool_calls', 'corrections'):
        value = record.get(key)
        require(value is None or nonnegative_number(value), f'{key} must be nonnegative or null')
    if record.get('observations') is not None:
        validate_observations(record['observations'])
    require(isinstance(record.get('checks'), list), 'Record needs checks')
    seen = set()
    for check in record['checks']:
        require(isinstance(check, dict) and isinstance(check.get('id'), str), 'Check needs an id')
        require(check['id'] and check['id'] not in seen, 'Check ids must be non-empty and unique')
        seen.add(check['id'])
        require('passed' in check and (check['passed'] is None or type(check['passed']) is bool), 'Check verdict must be boolean or null')
        require(isinstance(check.get('evidence'), str) and check['evidence'].strip(), 'Check evidence is required')
    return record

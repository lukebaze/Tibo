"""Parse untrusted skill metadata using safe YAML and validate known field types."""

import re


class MissingDependencyError(RuntimeError):
    """Raised when a required environment dependency is unavailable.

    This signals an environment fault, not a skill-content validation error:
    the skill itself may be entirely valid, but the validator cannot run
    without the dependency installed. Callers must not report this the same
    way as a genuine validation failure.
    """


def parse_frontmatter(text):
    try:
        import yaml
    except ImportError as exc:
        raise MissingDependencyError(
            'environment error: PyYAML is not installed. Run with uv run --with '
            'PyYAML==6.0.3 python, or install scripts/requirements.txt into your '
            'managed Python environment.'
        ) from exc

    class UniqueKeyLoader(yaml.SafeLoader):
        pass

    def mapping(loader, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError('YAML mapping keys must be strings')
            if key in result:
                raise ValueError(f'Duplicate YAML key: {key}')
            result[key] = loader.construct_object(value_node, deep=deep)
        return result

    UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    try:
        data = yaml.load(text, Loader=UniqueKeyLoader)
    except yaml.YAMLError as exc:
        mark = getattr(exc, 'problem_mark', None)
        location = f' at line {mark.line + 2}' if mark else ''
        # Parser exceptions can echo input; report the location without metadata values.
        raise ValueError(f'Invalid YAML frontmatter{location}') from exc
    if not isinstance(data, dict):
        raise ValueError('Frontmatter must be a YAML mapping')
    return data


def metadata_errors(data):
    errors = []
    for key in ('name', 'description'):
        if not isinstance(data.get(key), str) or not data[key].strip():
            errors.append(f"'{key}' must be a non-empty string")
    for key in ('when_to_use', 'category', 'argument-hint', 'license', 'compatibility'):
        if key in data and not isinstance(data[key], str):
            errors.append(f"'{key}' must be a string")
    for key in ('user-invocable', 'disable-model-invocation'):
        if key in data and not isinstance(data[key], bool):
            errors.append(f"'{key}' must be a boolean")
    for key in ('keywords', 'allowed-tools'):
        if key not in data:
            continue
        value = data[key]
        if key == 'allowed-tools' and isinstance(value, str):
            continue
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            errors.append(f"'{key}' must be a list of strings" + (' or a string' if key == 'allowed-tools' else ''))
    metadata = data.get('metadata', {})
    if not isinstance(metadata, dict):
        errors.append("'metadata' must be a mapping")
    elif 'version' in metadata:
        version = metadata['version']
        if not isinstance(version, str) or not re.fullmatch(
            r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?', version
        ):
            errors.append("'metadata.version' must be a quoted semantic version")
    return errors

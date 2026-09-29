/**
 * Hand-rolled minimal YAML subset parser for ak-journal config files.
 *
 * Supports exactly what `.agentkit/journal.yaml` and the `journal:` block of
 * `.agentkit/config.yaml` / `~/.agentkit/config.yaml` need:
 *   - nested maps via 2-space indentation
 *   - scalar values: unquoted, single-quoted, double-quoted strings,
 *     booleans (true/false), null (null/~/empty), integers/floats
 *   - lists of scalars (`- value` block style)
 *   - lists of maps / "array-of-maps" (`- key: value` block style, with
 *     following indented `key: value` lines belonging to the same list item)
 *   - inline flow lists of maps: `channels: [{id: x, platform: y}, {...}]`
 *   - full-line comments (`# ...`) and inline comments after a scalar value
 *   - blank lines
 *
 * Deliberately NOT supported (out of scope for this skill's config shape):
 *   anchors/aliases, multi-doc streams, block scalars (| / >), tags, dates.
 *
 * Kept under 200 lines per plan constraint (see AMENDMENTS.md G1/Phase 1);
 * if this needs to grow past that, restructure `channels` as a keyed map
 * instead of array-of-maps (documented fallback).
 */

function stripInlineComment(text) {
  // Only strip a `#` that starts a new token (preceded by whitespace or at
  // start) and is not inside quotes.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i);
    }
  }
  return text;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '' || value === '~' || value === 'null' || value === 'Null' || value === 'NULL') {
    return null;
  }
  if (value === 'true' || value === 'True' || value === 'TRUE') return true;
  if (value === 'false' || value === 'False' || value === 'FALSE') return false;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return parseFlowList(value);
  }
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

/** Parse a flow-style list: `[a, b, {k: v}, "c"]`. Minimal, no nested flow maps beyond 1 level. */
function parseFlowList(text) {
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  const items = splitFlowItems(inner);
  return items.map((item) => {
    const trimmed = item.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return parseFlowMap(trimmed);
    }
    return parseScalar(trimmed);
  });
}

function parseFlowMap(text) {
  const inner = text.slice(1, -1).trim();
  const map = {};
  if (inner === '') return map;
  const pairs = splitFlowItems(inner);
  for (const pair of pairs) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim().replace(/^["']|["']$/g, '');
    const value = pair.slice(idx + 1).trim();
    map[key] = parseScalar(value);
  }
  return map;
}

/** Split top-level comma-separated items in a flow list/map, respecting nesting + quotes. */
function splitFlowItems(text) {
  const items = [];
  let depth = 0;
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of text) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === '{' || ch === '[') depth += 1;
      if (ch === '}' || ch === ']') depth -= 1;
      if (ch === ',' && depth === 0) {
        items.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(current);
  return items;
}

function indentOf(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

/**
 * Parse YAML block-style text into a plain JS object.
 * @param {string} content
 * @returns {Record<string, unknown>}
 */
function parseYaml(content) {
  const rawLines = content.split('\n');
  const lines = [];
  for (const rawLine of rawLines) {
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;
    const withoutComment = stripInlineComment(rawLine).replace(/\s+$/, '');
    if (withoutComment.trim() === '') continue;
    lines.push({ indent: indentOf(rawLine), text: withoutComment.trim() });
  }

  let pos = 0;

  function parseBlock(indent) {
    const result = {};
    while (pos < lines.length && lines[pos].indent >= indent) {
      const line = lines[pos];
      if (line.indent > indent) {
        // Orphaned deeper indent with no owning key — skip defensively.
        pos += 1;
        continue;
      }
      if (line.text.startsWith('- ') || line.text === '-') {
        // A bare list at this indent with no key is invalid in our subset; skip.
        pos += 1;
        continue;
      }
      const colonIdx = line.text.indexOf(':');
      if (colonIdx === -1) {
        pos += 1;
        continue;
      }
      const key = line.text.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
      const rest = line.text.slice(colonIdx + 1).trim();
      pos += 1;

      if (rest !== '') {
        result[key] = parseScalar(rest);
        continue;
      }

      // No inline value: either a nested map or a list follows at deeper indent.
      if (pos < lines.length && lines[pos].indent > indent && lines[pos].text.startsWith('- ')) {
        result[key] = parseList(lines[pos].indent);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        result[key] = parseBlock(lines[pos].indent);
      } else {
        result[key] = null;
      }
    }
    return result;
  }

  function parseList(indent) {
    const items = [];
    while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('-')) {
      const line = lines[pos];
      const afterDash = line.text.slice(1).trim();
      pos += 1;

      if (afterDash === '') {
        // "-" alone on its line, nested map follows more indented.
        if (pos < lines.length && lines[pos].indent > indent) {
          items.push(parseBlock(lines[pos].indent));
        } else {
          items.push(null);
        }
        continue;
      }

      const colonIdx = afterDash.indexOf(':');
      if (colonIdx === -1) {
        // Plain scalar list item (`- value`), possibly a flow list/map.
        items.push(parseScalar(afterDash));
        continue;
      }

      // "- key: value" starts an array-of-maps item; subsequent more-indented
      // "key: value" lines (indent === indent + 2, i.e. deeper than the dash
      // column) belong to the same map item.
      const itemIndent = indent + 2;
      const firstKey = afterDash.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
      const firstRest = afterDash.slice(colonIdx + 1).trim();
      const map = { [firstKey]: firstRest === '' ? null : parseScalar(firstRest) };

      while (pos < lines.length && lines[pos].indent === itemIndent) {
        const innerLine = lines[pos];
        const innerColon = innerLine.text.indexOf(':');
        if (innerColon === -1) break;
        const innerKey = innerLine.text.slice(0, innerColon).trim().replace(/^["']|["']$/g, '');
        const innerRest = innerLine.text.slice(innerColon + 1).trim();
        pos += 1;
        if (innerRest !== '') {
          map[innerKey] = parseScalar(innerRest);
        } else if (pos < lines.length && lines[pos].indent > itemIndent && lines[pos].text.startsWith('-')) {
          map[innerKey] = parseList(lines[pos].indent);
        } else if (pos < lines.length && lines[pos].indent > itemIndent) {
          map[innerKey] = parseBlock(lines[pos].indent);
        } else {
          map[innerKey] = null;
        }
      }
      items.push(map);
    }
    return items;
  }

  return parseBlock(0);
}

module.exports = { parseYaml, parseScalar, parseFlowList, parseFlowMap };

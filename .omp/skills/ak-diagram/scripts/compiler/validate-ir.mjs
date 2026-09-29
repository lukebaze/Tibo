/**
 * ak:diagram typed IR validation (schema envelope, ID discipline, dangling endpoints, text limits).
 * Extracted from compile.mjs; the compiler calls validateIR before any layout work.
 */

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function checkSafeText(val, name) {
  if (val !== undefined && val !== null) {
    if (typeof val !== 'string') {
      throw new Error(`Invalid IR: ${name} must be a string`);
    }
    if (val.length > 512) {
      throw new Error(`Invalid IR: ${name} exceeds maximum length of 512 characters`);
    }
  }
}

function validateIR(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid IR: Root must be an object');
  }
  if (data.schema_version !== 1 && data.schemaVersion !== 1) {
    throw new Error('Invalid IR: schema_version must be 1');
  }
  const type = data.diagram_type || data.type;
  const validTypes = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid IR: unknown diagram_type "${type}". Must be one of ${validTypes.join(', ')}`);
  }
  if (!data.meta || typeof data.meta !== 'object') {
    throw new Error('Invalid IR: meta object is required');
  }
  if (!data.meta.title || typeof data.meta.title !== 'string') {
    throw new Error('Invalid IR: meta.title string is required');
  }
  checkSafeText(data.meta.title, 'meta.title');
  checkSafeText(data.meta.subtitle, 'meta.subtitle');
  checkSafeText(data.meta.description, 'meta.description');

  const validPresets = ['classic', 'signal-flow', 'blueprint', 'editorial'];
  if (data.meta.visual_preset && !validPresets.includes(data.meta.visual_preset)) {
    throw new Error(`Invalid IR: unknown visual_preset "${data.meta.visual_preset}". Must be one of ${validPresets.join(', ')}`);
  }
  const validThemes = ['light', 'dark'];
  if (data.meta.theme && !validThemes.includes(data.meta.theme)) {
    throw new Error(`Invalid IR: unknown theme "${data.meta.theme}". Must be one of ${validThemes.join(', ')}`);
  }

  const nodeIds = new Set();
  const checkId = (id, kind) => {
    if (!id || typeof id !== 'string') {
      throw new Error(`Invalid IR: ${kind} ID must be a non-empty string`);
    }
    if (!ID_REGEX.test(id)) {
      throw new Error(`Invalid IR: ${kind} ID "${id}" must match pattern ^[a-zA-Z0-9_-]{1,64}$`);
    }
    if (nodeIds.has(id)) {
      throw new Error(`Invalid IR: duplicate ID "${id}" in ${kind}`);
    }
    nodeIds.add(id);
  };

  const checkLabel = (item, kind) => {
    if (!item.label || typeof item.label !== 'string') {
      throw new Error(`Invalid IR: ${kind} "${item.id || 'unnamed'}" missing required string "label"`);
    }
    checkSafeText(item.label, `${kind}.label`);
    checkSafeText(item.description, `${kind}.description`);
  };

  if (type === 'architecture') {
    const components = data.components || [];
    if (!Array.isArray(components) || components.length === 0) {
      throw new Error('Invalid IR: architecture requires non-empty components array');
    }
    if (components.length > 250) {
      throw new Error('Invalid IR: architecture components exceed limit of 250');
    }
    const validRoles = ['frontend', 'backend', 'database', 'cache', 'queue', 'storage', 'gateway', 'auth', 'external', 'worker'];
    components.forEach(c => {
      checkId(c.id, 'component');
      checkLabel(c, 'component');
      if (c.role && !validRoles.includes(c.role)) {
        throw new Error(`Invalid IR: component "${c.id}" has invalid role "${c.role}". Must be one of ${validRoles.join(', ')}`);
      }
    });

    const connections = data.connections || [];
    if (connections.length > 1000) {
      throw new Error('Invalid IR: connections exceed limit of 1000');
    }
    connections.forEach((conn, idx) => {
      if (conn.id) checkSafeText(conn.id, `connections[${idx}].id`);
      checkSafeText(conn.label, `connections[${idx}].label`);
      checkSafeText(conn.protocol, `connections[${idx}].protocol`);
      if (!conn.from || !nodeIds.has(conn.from)) {
        throw new Error(`Invalid IR: dangling connection "from" endpoint "${conn.from}" at index ${idx}`);
      }
      if (!conn.to || !nodeIds.has(conn.to)) {
        throw new Error(`Invalid IR: dangling connection "to" endpoint "${conn.to}" at index ${idx}`);
      }
    });
  } else if (type === 'workflow') {
    const steps = data.steps || [];
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Invalid IR: workflow requires non-empty steps array');
    }
    if (steps.length > 250) {
      throw new Error('Invalid IR: workflow steps exceed limit of 250');
    }
    const validKinds = ['start', 'action', 'decision', 'wait', 'subprocess', 'terminal-success', 'terminal-failure'];
    steps.forEach(s => {
      checkId(s.id, 'step');
      checkLabel(s, 'step');
      if (s.kind && !validKinds.includes(s.kind)) {
        throw new Error(`Invalid IR: step "${s.id}" has invalid kind "${s.kind}". Must be one of ${validKinds.join(', ')}`);
      }
    });

    const transitions = data.transitions || [];
    if (transitions.length > 1000) {
      throw new Error('Invalid IR: transitions exceed limit of 1000');
    }
    transitions.forEach((t, idx) => {
      if (t.id) checkSafeText(t.id, `transitions[${idx}].id`);
      checkSafeText(t.label, `transitions[${idx}].label`);
      checkSafeText(t.condition, `transitions[${idx}].condition`);
      if (!t.from || !nodeIds.has(t.from)) {
        throw new Error(`Invalid IR: dangling transition "from" endpoint "${t.from}" at index ${idx}`);
      }
      if (!t.to || !nodeIds.has(t.to)) {
        throw new Error(`Invalid IR: dangling transition "to" endpoint "${t.to}" at index ${idx}`);
      }
    });
  } else if (type === 'sequence') {
    const participants = data.participants || [];
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new Error('Invalid IR: sequence requires non-empty participants array');
    }
    if (participants.length > 50) {
      throw new Error('Invalid IR: sequence participants exceed limit of 50');
    }
    participants.forEach(p => {
      checkId(p.id, 'participant');
      checkLabel(p, 'participant');
    });

    const messages = data.messages || [];
    if (messages.length > 500) {
      throw new Error('Invalid IR: sequence messages exceed limit of 500');
    }
    const validMsgKinds = ['sync-call', 'async-signal', 'return', 'self-call', 'error'];
    messages.forEach((m, idx) => {
      if (!m.label || typeof m.label !== 'string') {
        throw new Error(`Invalid IR: message at index ${idx} missing required string "label"`);
      }
      checkSafeText(m.label, `messages[${idx}].label`);
      if (m.kind && !validMsgKinds.includes(m.kind)) {
        throw new Error(`Invalid IR: message at index ${idx} has invalid kind "${m.kind}"`);
      }
      if (!m.from || !nodeIds.has(m.from)) {
        throw new Error(`Invalid IR: dangling message "from" endpoint "${m.from}" at index ${idx}`);
      }
      if (!m.to || !nodeIds.has(m.to)) {
        throw new Error(`Invalid IR: dangling message "to" endpoint "${m.to}" at index ${idx}`);
      }
    });
  } else if (type === 'dataflow') {
    const nodes = data.nodes || [];
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error('Invalid IR: dataflow requires non-empty nodes array');
    }
    if (nodes.length > 250) {
      throw new Error('Invalid IR: dataflow nodes exceed limit of 250');
    }
    const validRoles = ['source', 'transform', 'store', 'sink', 'consumer', 'filter', 'governance'];
    nodes.forEach(n => {
      checkId(n.id, 'dataflow node');
      checkLabel(n, 'dataflow node');
      if (n.role && !validRoles.includes(n.role)) {
        throw new Error(`Invalid IR: dataflow node "${n.id}" has invalid role "${n.role}"`);
      }
    });

    const flows = data.flows || [];
    if (flows.length > 1000) {
      throw new Error('Invalid IR: dataflow flows exceed limit of 1000');
    }
    flows.forEach((f, idx) => {
      checkSafeText(f.label, `flows[${idx}].label`);
      checkSafeText(f.schema_type, `flows[${idx}].schema_type`);
      if (!f.from || !nodeIds.has(f.from)) {
        throw new Error(`Invalid IR: dangling flow "from" endpoint "${f.from}" at index ${idx}`);
      }
      if (!f.to || !nodeIds.has(f.to)) {
        throw new Error(`Invalid IR: dangling flow "to" endpoint "${f.to}" at index ${idx}`);
      }
    });
  } else if (type === 'lifecycle') {
    const states = data.states || [];
    if (!Array.isArray(states) || states.length === 0) {
      throw new Error('Invalid IR: lifecycle requires non-empty states array');
    }
    if (states.length > 250) {
      throw new Error('Invalid IR: lifecycle states exceed limit of 250');
    }
    const validKinds = ['initial', 'active', 'waiting', 'failure-recoverable', 'failure-fatal', 'terminal-success', 'terminal-cancelled'];
    states.forEach(s => {
      checkId(s.id, 'state');
      checkLabel(s, 'state');
      if (s.kind && !validKinds.includes(s.kind)) {
        throw new Error(`Invalid IR: state "${s.id}" has invalid kind "${s.kind}"`);
      }
    });

    const transitions = data.transitions || [];
    if (transitions.length > 1000) {
      throw new Error('Invalid IR: lifecycle transitions exceed limit of 1000');
    }
    transitions.forEach((t, idx) => {
      checkSafeText(t.event, `transitions[${idx}].event`);
      checkSafeText(t.action, `transitions[${idx}].action`);
      if (!t.from || !nodeIds.has(t.from)) {
        throw new Error(`Invalid IR: dangling lifecycle transition "from" endpoint "${t.from}" at index ${idx}`);
      }
      if (!t.to || !nodeIds.has(t.to)) {
        throw new Error(`Invalid IR: dangling lifecycle transition "to" endpoint "${t.to}" at index ${idx}`);
      }
    });
  }

  if (data.meta.views && Array.isArray(data.meta.views)) {
    if (data.meta.views.length > 5) {
      throw new Error('Invalid IR: views/chapters exceed maximum limit of 5');
    }
    data.meta.views.forEach((v, vIdx) => {
      checkSafeText(v.title, `views[${vIdx}].title`);
      checkSafeText(v.narrative, `views[${vIdx}].narrative`);
      if (v.focus_nodes && Array.isArray(v.focus_nodes)) {
        v.focus_nodes.forEach(fn => {
          if (!nodeIds.has(fn)) {
            throw new Error(`Invalid IR: view "${v.id || vIdx}" references non-existent focus node "${fn}"`);
          }
        });
      }
      if (v.highlight_route && Array.isArray(v.highlight_route)) {
        v.highlight_route.forEach(rn => {
          if (!nodeIds.has(rn)) {
            throw new Error(`Invalid IR: view "${v.id || vIdx}" references non-existent route node "${rn}"`);
          }
        });
      }
    });
  }

  return type;
}

export { validateIR, checkSafeText, ID_REGEX };

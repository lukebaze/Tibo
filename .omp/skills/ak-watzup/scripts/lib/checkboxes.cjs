'use strict';

// Scans markdown todo checkboxes inside plan directories.
// Used by watzup-scan to compute per-plan progress without parsing full markdown ASTs.

const fs = require('node:fs');
const path = require('node:path');

const CHECKBOX_OPEN_RE = /^\s*[-*]\s+\[\s\]/gm;
const CHECKBOX_DONE_RE = /^\s*[-*]\s+\[[xX]\]/gm;

function countCheckboxesInText(text) {
  return {
    open: (text.match(CHECKBOX_OPEN_RE) || []).length,
    closed: (text.match(CHECKBOX_DONE_RE) || []).length,
  };
}

function toProgress(open, closed) {
  const total = open + closed;
  if (total === 0) return null;
  return { open, closed, total, complete: closed / total };
}

// Walk a plan directory (depth 1), aggregate checkbox totals, and split by phase file.
// Returns null if the directory holds no markdown checkboxes at all.
function scanPlanDirectory(planDir, warnings) {
  if (!planDir || !fs.existsSync(planDir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(planDir, { withFileTypes: true });
  } catch (error) {
    warnings.push(`could not read plan directory ${planDir}: ${error.message}`);
    return null;
  }

  const totals = { open: 0, closed: 0 };
  const phases = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(planDir, entry.name);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      warnings.push(`could not read ${filePath}: ${error.message}`);
      continue;
    }
    const counts = countCheckboxesInText(content);
    totals.open += counts.open;
    totals.closed += counts.closed;
    const isPhase = entry.name.toLowerCase().startsWith('phase-');
    if (isPhase && counts.open + counts.closed > 0) {
      phases.push({
        file: entry.name,
        open: counts.open,
        closed: counts.closed,
        complete: counts.closed / (counts.open + counts.closed),
      });
    }
  }

  const summary = toProgress(totals.open, totals.closed);
  if (!summary) return null;
  return { ...summary, phases: phases.sort((a, b) => a.file.localeCompare(b.file)) };
}

module.exports = { countCheckboxesInText, scanPlanDirectory, toProgress };

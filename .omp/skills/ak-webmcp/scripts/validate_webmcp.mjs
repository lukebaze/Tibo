#!/usr/bin/env node
// Static linter for WebMCP tool definitions. Dependency-free (Node built-ins).
//
// Severity model (see references/api-reference.md):
//   ERROR   (spec-derived)  : empty/missing name or description; name charset
//                             ^[A-Za-z0-9_.-]{1,128}$; duplicate name in a file;
//                             non-JSON-serializable inputSchema.
//   WARNING (Chrome budgets  : name>30, description>500, param name>30,
//            + heuristics)     param description>150, write/irreversible tool
//                             missing consequentialHint, UGC tool missing
//                             untrustedContentHint.
//   --strict promotes every WARNING to an ERROR (non-zero exit).
//
// Extraction (default): brace-match the object literal at each
// registerTool()/useWebMCP() call and parse its string fields statically. This
// never executes the source under lint. LIMITATION: static mode measures only
// literal strings: a computed description/name (concatenation, `.repeat()`,
// tagged/multi-line templates) is read as its literal fragment and thus
// under-measured against character budgets. Use --eval to measure those.
//
// --eval opts into a higher-fidelity path that evaluates ONLY the extracted
// literal in a sandboxed node:vm context whose free identifiers resolve to
// undefined (execute bodies are never run), falling back to static parsing when
// eval fails. node:vm is NOT a security boundary; use --eval only on trusted
// sources.
//
// HTML: regex over <form> WebMCP attributes plus inline <script> tools. Known
// limitation: controls associated via the form= attribute outside the <form>
// are not counted.
//
// Usage: validate_webmcp.mjs [--strict] [--eval] <file> [file...]

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import vm from "node:vm";

const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const NAME_BUDGET = 30;
const DESC_BUDGET = 500;
const PARAM_DESC_BUDGET = 150;

const CONSEQUENTIAL_HINTS = /\b(book|buy|purchase|pay|payment|transfer|delete|remove|cancel|order|checkout|send|submit|post|create|update|charge|withdraw|deposit)\b/i;
const UNTRUSTED_HINTS = /\b(review|comment|message|ugc|user[-\s]?generated|feedback|post|scrape|external|fetch|rating|forum)\b/i;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const useEval = args.includes("--eval");
const files = args.filter((a) => !a.startsWith("--"));

const findings = []; // { file, severity: 'error'|'warn', msg }
const add = (file, severity, msg) => findings.push({ file, severity, msg });
const error = (file, msg) => add(file, "error", msg);
const warn = (file, msg) => add(file, strict ? "error" : "warn", msg);

// --- object-literal extraction -------------------------------------------

// Return {text, end} for the {...} starting at or after idx (brace-matched,
// string/template aware), or null.
function extractObjectText(src, idx) {
  const start = src.indexOf("{", idx);
  if (start === -1) return null;
  let depth = 0, str = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { text: src.slice(start, i + 1), end: i + 1 }; }
  }
  return null;
}

// Evaluate a literal in a sandbox where every free identifier is undefined.
function evalLiteral(text) {
  const sandbox = new Proxy({}, {
    has: () => true,
    get: (_t, key) => (key === Symbol.unscopables ? undefined : undefined),
  });
  const context = vm.createContext(sandbox);
  try {
    return vm.runInContext("(" + text + ")", context, { timeout: 200 });
  } catch {
    return null;
  }
}

// String fallbacks when eval is off or fails.
function strValue(obj, key) {
  const re = new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`);
  const m = obj.match(re);
  return m ? m[2] : null;
}
function hintTrue(obj, hint) {
  return new RegExp(`${hint}\\s*:\\s*true`).test(obj);
}
function stringExtractParams(objText) {
  const names = [], descs = [];
  const iIdx = objText.search(/inputSchema\s*:/);
  if (iIdx === -1) return { names, descs };
  const schema = extractObjectText(objText, iIdx);
  if (!schema) return { names, descs };
  const pIdx = schema.text.search(/properties\s*:/);
  if (pIdx === -1) return { names, descs };
  const props = extractObjectText(schema.text, pIdx);
  if (!props) return { names, descs };
  const keyRe = /(['"]?)([A-Za-z_$][\w$-]*)\1\s*:\s*\{/g;
  let m;
  while ((m = keyRe.exec(props.text)) !== null) {
    const name = m[2];
    if (name === "properties" || name === "items") continue;
    names.push(name);
    const propObj = extractObjectText(props.text, m.index + m[0].length - 1);
    if (propObj) {
      const d = strValue(propObj.text, "description");
      if (d !== null) descs.push({ name, desc: d });
    }
  }
  return { names, descs };
}

// Normalize an extracted tool to a common shape.
function toModel(objText) {
  if (useEval) {
    const obj = evalLiteral(objText);
    if (obj && typeof obj === "object") {
      const names = [], descs = [];
      const props = obj.inputSchema && obj.inputSchema.properties;
      if (props && typeof props === "object") {
        for (const [k, v] of Object.entries(props)) {
          names.push(k);
          if (v && typeof v.description === "string") descs.push({ name: k, desc: v.description });
        }
      }
      const a = obj.annotations || {};
      let schemaSerializable = true;
      if (obj.inputSchema !== undefined) {
        try { JSON.stringify(obj.inputSchema); } catch { schemaSerializable = false; }
      }
      return {
        name: typeof obj.name === "string" ? obj.name : null,
        description: typeof obj.description === "string" ? obj.description : null,
        readOnly: a.readOnlyHint === true,
        consequential: a.consequentialHint === true,
        untrusted: a.untrustedContentHint === true,
        names, descs, schemaSerializable, source: "eval",
      };
    }
  }
  // string fallback
  const { names, descs } = stringExtractParams(objText);
  return {
    name: strValue(objText, "name"),
    description: strValue(objText, "description"),
    readOnly: hintTrue(objText, "readOnlyHint"),
    consequential: hintTrue(objText, "consequentialHint"),
    untrusted: hintTrue(objText, "untrustedContentHint"),
    names, descs, schemaSerializable: true, source: "string",
  };
}

// --- checks ---------------------------------------------------------------

function checkModel(file, m, seenNames) {
  const label = m.name ? `tool '${m.name}'` : "tool (unnamed)";
  if (!m.name) error(file, `${label}: missing or empty name`);
  else {
    if (!NAME_RE.test(m.name)) error(file, `${label}: name violates ^[A-Za-z0-9_.-]{1,128}$`);
    if (seenNames.has(m.name)) error(file, `${label}: duplicate tool name in this file (throws InvalidStateError)`);
    seenNames.add(m.name);
    if (m.name.length > NAME_BUDGET) warn(file, `${label}: name is ${m.name.length} chars (budget ${NAME_BUDGET})`);
  }
  if (!m.description) error(file, `${label}: missing or empty description`);
  else if (m.description.length > DESC_BUDGET) warn(file, `${label}: description is ${m.description.length} chars (budget ${DESC_BUDGET})`);

  if (!m.schemaSerializable) error(file, `${label}: inputSchema is not JSON-serializable (throws TypeError)`);

  for (const pn of m.names) if (pn.length > NAME_BUDGET) warn(file, `${label}: param name '${pn}' is ${pn.length} chars (budget ${NAME_BUDGET})`);
  for (const { name: pn, desc } of m.descs) if (desc.length > PARAM_DESC_BUDGET) warn(file, `${label}: param '${pn}' description is ${desc.length} chars (budget ${PARAM_DESC_BUDGET})`);

  const hay = `${m.name || ""} ${m.description || ""}`;
  if (!m.readOnly && !m.consequential && CONSEQUENTIAL_HINTS.test(hay))
    warn(file, `${label}: looks write/irreversible but no annotations.consequentialHint: true`);
  if (!m.untrusted && UNTRUSTED_HINTS.test(hay))
    warn(file, `${label}: may return untrusted content but no annotations.untrustedContentHint: true`);
}

// Remove JS line/block comments (string/template aware) so a keyword inside a
// comment or docstring is never mistaken for a tool call.
function stripComments(src) {
  let out = "", i = 0, str = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (str) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === str) str = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; out += c; i++; continue; }
    if (c === "/" && d === "/") { i += 2; while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// Return the tool object literal text for a call whose first argument starts at
// position `after`. Handles inline literals and `const NAME = {...}` references.
// Returns null when the argument is not a resolvable object literal.
function resolveToolArg(src, after) {
  let p = after;
  while (p < src.length && /\s/.test(src[p])) p++;
  if (src[p] === "{") return extractObjectText(src, p)?.text ?? null;
  if (/[A-Za-z_$]/.test(src[p])) {
    let id = "";
    while (p < src.length && /[\w$]/.test(src[p])) { id += src[p]; p++; }
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*=\\s*`).exec(src);
    if (decl) {
      let q = decl.index + decl[0].length;
      while (q < src.length && /\s/.test(src[q])) q++;
      if (src[q] === "{") return extractObjectText(src, q)?.text ?? null;
    }
    return id; // unresolved reference marker
  }
  return null;
}

function scanScriptTools(file, rawSrc, seen) {
  const src = stripComments(rawSrc);
  let count = 0;
  for (const kw of ["registerTool", "useWebMCP"]) {
    const callRe = new RegExp(`\\b${kw}\\s*\\(`, "g");
    let m;
    while ((m = callRe.exec(src)) !== null) {
      const arg = resolveToolArg(src, m.index + m[0].length);
      if (arg === null) continue;
      if (!arg.startsWith("{")) {
        console.error(`note  ${file}: ${kw} tool passed by reference ('${arg}') - not statically checkable`);
        continue;
      }
      checkModel(file, toModel(arg), seen);
      count++;
    }
  }
  return count;
}

function attr(tag, name) {
  const withVal = tag.match(new RegExp(`\\b${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, "i"));
  if (withVal) return withVal[2];
  if (new RegExp(`\\b${name}\\b`, "i").test(tag)) return "";
  return null;
}

function lintHtml(file, src) {
  let count = 0;
  const seen = new Set();
  // Lint imperative tools declared in inline <script> blocks; they share the
  // document tool map, so duplicate names across forms and scripts collide.
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let sm, js = "";
  while ((sm = scriptRe.exec(src)) !== null) js += sm[1] + "\n";
  count += scanScriptTools(file, js, seen);
  const formRe = /<form\b[\s\S]*?>/gi;
  let m;
  while ((m = formRe.exec(src)) !== null) {
    const tag = m[0];
    const name = attr(tag, "toolname");
    if (name === null) continue; // not a WebMCP form
    count++;
    const description = attr(tag, "tooldescription");
    const label = `form toolname '${name || ""}'`;
    if (!name) error(file, `form: empty toolname`);
    else {
      if (!NAME_RE.test(name)) error(file, `${label}: name violates ^[A-Za-z0-9_.-]{1,128}$`);
      if (seen.has(name)) error(file, `${label}: duplicate toolname in this file`);
      seen.add(name);
      if (name.length > NAME_BUDGET) warn(file, `${label}: name is ${name.length} chars (budget ${NAME_BUDGET})`);
    }
    if (description === null || description === "") error(file, `${label}: missing tooldescription`);
    else if (description.length > DESC_BUDGET) warn(file, `${label}: tooldescription is ${description.length} chars (budget ${DESC_BUDGET})`);

    const close = src.indexOf("</form>", formRe.lastIndex);
    const scope = src.slice(m.index, close === -1 ? src.length : close);
    const pdRe = /toolparamdescription\s*=\s*(['"])([\s\S]*?)\1/gi;
    let pm;
    while ((pm = pdRe.exec(scope)) !== null)
      if (pm[2].length > PARAM_DESC_BUDGET) warn(file, `${label}: a toolparamdescription is ${pm[2].length} chars (budget ${PARAM_DESC_BUDGET})`);
  }
  return count;
}

function main() {
  if (files.length === 0) {
    console.error("usage: validate_webmcp.mjs [--strict] [--eval] <file> [file...]");
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    let src;
    try { src = readFileSync(file, "utf8"); }
    catch (e) { error(file, `cannot read: ${e.message}`); continue; }
    const ext = extname(file).toLowerCase();
    total += (ext === ".html" || ext === ".htm") ? lintHtml(file, src) : scanScriptTools(file, src, new Set());
  }

  // deterministic order
  const rank = { error: 0, warn: 1 };
  findings.sort((a, b) =>
    a.file.localeCompare(b.file) || rank[a.severity] - rank[b.severity] || a.msg.localeCompare(b.msg));
  for (const f of findings)
    console.error(`${f.severity === "error" ? "ERROR" : "warn "} ${f.file}: ${f.msg}`);

  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  console.error(`\n${total} tool(s) checked - ${errors} error(s), ${warns} warning(s).`);
  if (total === 0) console.error("note: no WebMCP tools detected (registerTool/useWebMCP/form toolname).");
  process.exit(errors > 0 ? 1 : 0);
}

main();

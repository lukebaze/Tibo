/**
 * Deterministic text metrics for the ak:diagram compiler.
 * No font is loaded at compile time, so widths are estimated from a per-glyph
 * table for a humanist sans face. The same input always yields the same width,
 * which keeps layout byte-deterministic across machines.
 */

const NARROW = new Set([...'iljtfrI.,:;!|\'`()[]{} ']);
const WIDE = new Set([...'mwMW@%']);
const DIGIT = /[0-9]/;
const UPPER = /[A-Z]/;

/** Estimated advance width of `text` at `fontSize` pixels. */
export function textWidth(text, fontSize = 12, weight = 400) {
  let units = 0;
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    if (NARROW.has(ch)) units += 0.3;
    else if (WIDE.has(ch)) units += 0.86;
    else if (code >= 0x2e80) units += 1.0; // CJK and other full-width scripts
    else if (code >= 0x300 && code <= 0x36f) units += 0; // combining diacritics
    else if (DIGIT.test(ch)) units += 0.56;
    else if (UPPER.test(ch)) units += 0.66;
    else units += 0.54;
  }
  return units * fontSize * (weight >= 600 ? 1.06 : 1);
}

/** Shorten `text` with an ellipsis so it fits `maxWidth` at the given size. */
export function truncateToWidth(text, maxWidth, fontSize = 12, weight = 400) {
  const source = String(text || '');
  if (textWidth(source, fontSize, weight) <= maxWidth) return source;
  const ellipsis = '…';
  let out = source;
  while (out.length > 1 && textWidth(out + ellipsis, fontSize, weight) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.trimEnd() + ellipsis;
}

/** Clamp helper shared by layout and routing. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Round to one decimal so serialized coordinates stay compact and stable. */
export function fmt(value) {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

#!/usr/bin/env node
/**
 * Splits a long journal body into a thread of posts for X/Twitter or
 * Threads (Meta). Pure, deterministic, no I/O beyond the CLI wrapper at the
 * bottom of this file.
 *
 * Split priority: paragraph (`\n\n`) > sentence (`. `) > word boundary.
 * Never splits mid-word or mid-code-fence (fenced code blocks are atomic).
 *
 * X (`platform: 'x'`) counts length using t.co URL-weighting: every URL
 * counts as exactly 23 chars regardless of its actual length, per X's
 * link-shortening behavior. Threads (`platform: 'threads'`) uses plain
 * `.length`.
 */

const URL_REGEX = /https?:\/\/\S+/g;
const CODE_FENCE_REGEX = /```[\s\S]*?```/g;

const LIMITS = Object.freeze({ x: 280, threads: 500 });
const X_URL_WEIGHT = 23;

/** Effective length of `text` under the given platform's counting rules. */
function effectiveLength(text, platform) {
  if (platform !== 'x') return text.length;
  const urls = text.match(URL_REGEX) || [];
  let length = text.length;
  for (const url of urls) {
    length += X_URL_WEIGHT - url.length;
  }
  return length;
}

/** Split `text` into paragraphs on blank lines, keeping fenced code blocks atomic. */
function splitIntoParagraphs(text) {
  // Protect code fences from paragraph/sentence splitting by extracting them
  // first and re-inserting as atomic units interleaved with surrounding text.
  const segments = [];
  let lastIndex = 0;
  let match;
  CODE_FENCE_REGEX.lastIndex = 0;
  while ((match = CODE_FENCE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  const paragraphs = [];
  for (const segment of segments) {
    if (segment.type === 'code') {
      paragraphs.push({ text: segment.value, atomic: true });
      continue;
    }
    const parts = segment.value.split(/\n\n+/);
    for (const part of parts) {
      if (part.trim() === '') continue;
      paragraphs.push({ text: part.replace(/^\n+|\n+$/g, ''), atomic: false });
    }
  }
  return paragraphs;
}

/** Split a paragraph into sentence-sized chunks that individually fit `limit`. */
function splitBySentence(text, platform, limit) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (effectiveLength(candidate, platform) <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (effectiveLength(sentence, platform) <= limit) {
      current = sentence;
    } else {
      chunks.push(...splitByWord(sentence, platform, limit));
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Split text on whitespace word boundaries so every chunk fits `limit`. Never mid-word. */
function splitByWord(text, platform, limit) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (effectiveLength(candidate, platform) <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    // A single word longer than the limit cannot be split without breaking
    // mid-word; keep it whole (post exceeds limit only in this edge case).
    current = word;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * @param {string} text raw input body
 * @param {object} [options]
 * @param {'x'|'threads'} [options.platform='x']
 * @param {number} [options.maxPosts=6]
 * @returns {{posts: string[], truncated: boolean, totalInputChars: number}}
 */
function splitThread(text, options = {}) {
  const platform = options.platform === 'threads' ? 'threads' : 'x';
  const maxPosts = Number.isInteger(options.maxPosts) && options.maxPosts > 0 ? options.maxPosts : 6;
  const limit = LIMITS[platform];
  const totalInputChars = typeof text === 'string' ? text.length : 0;

  const trimmedInput = (text || '').trim();
  if (trimmedInput === '') {
    return { posts: [], truncated: false, totalInputChars: 0 };
  }

  // Single post fits as-is: no numbering, no splitting needed.
  if (effectiveLength(trimmedInput, platform) <= limit) {
    return { posts: [trimmedInput], truncated: false, totalInputChars };
  }

  const paragraphs = splitIntoParagraphs(trimmedInput);
  const rawChunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.atomic) {
      rawChunks.push(paragraph.text);
      continue;
    }
    if (effectiveLength(paragraph.text, platform) <= limit) {
      rawChunks.push(paragraph.text);
      continue;
    }
    rawChunks.push(...splitBySentence(paragraph.text, platform, limit));
  }

  // Pack chunks into posts, combining adjacent chunks while they still fit.
  const packed = [];
  let current = '';
  for (const chunk of rawChunks) {
    const candidate = current ? `${current}\n\n${chunk}` : chunk;
    if (effectiveLength(candidate, platform) <= limit) {
      current = candidate;
      continue;
    }
    if (current) packed.push(current);
    current = chunk;
  }
  if (current) packed.push(current);

  let truncated = false;
  let posts = packed;
  if (posts.length > maxPosts) {
    truncated = true;
    posts = posts.slice(0, maxPosts);
    const last = posts[maxPosts - 1];
    const ellipsisBudget = limit - 1; // reserve 1 char for the trailing ellipsis
    const truncatedLast =
      effectiveLength(last, platform) <= ellipsisBudget ? last : truncateToLimit(last, platform, ellipsisBudget);
    posts[maxPosts - 1] = `${truncatedLast}…`;
  }

  // Reserve numbering budget " (i/N)" before final packing check; only
  // applied when there is more than one post.
  if (posts.length > 1) {
    const total = posts.length;
    posts = posts.map((post, index) => {
      const suffix = ` (${index + 1}/${total})`;
      const budget = limit - effectiveLength(suffix, platform);
      const fitted = effectiveLength(post, platform) <= budget ? post : truncateToLimit(post, platform, budget);
      return `${fitted}${suffix}`;
    });
  }

  return { posts, truncated, totalInputChars };
}

/** Truncate `text` (word-boundary-safe) so its effective length fits `budget`. */
function truncateToLimit(text, platform, budget) {
  if (budget <= 0) return '';
  if (effectiveLength(text, platform) <= budget) return text;
  const words = text.split(/\s+/).filter(Boolean);
  let result = '';
  for (const word of words) {
    const candidate = result ? `${result} ${word}` : word;
    if (effectiveLength(candidate, platform) > budget) break;
    result = candidate;
  }
  if (result) return result;
  // Fallback: no whole word fits — hard-cut by character (still not
  // mid-word-preserving, but only reachable with a pathological single
  // word longer than the entire budget).
  return text.slice(0, Math.max(0, budget));
}

function printTruncationWarning(result) {
  if (!result.truncated) return;
  const last = result.posts[result.posts.length - 1] || '';
  console.error(
    `warning: input exceeds ${result.posts.length} posts; last post ends with "${last.slice(-1)}"; consider shortening`
  );
}

function main() {
  const { parseArgs } = require('util');
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        platform: { type: 'string', default: 'x' },
        'max-posts': { type: 'string', default: '6' },
        text: { type: 'string' },
        'text-file': { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`[split-thread] invalid arguments: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let text = values.text;
  if (text === undefined && values['text-file']) {
    text = require('fs').readFileSync(values['text-file'], 'utf8');
  }
  if (text === undefined) {
    text = require('fs').readFileSync(0, 'utf8'); // stdin
  }

  const result = splitThread(text, {
    platform: values.platform,
    maxPosts: parseInt(values['max-posts'], 10),
  });

  printTruncationWarning(result);
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main();
}

module.exports = { splitThread, effectiveLength, LIMITS, printTruncationWarning };

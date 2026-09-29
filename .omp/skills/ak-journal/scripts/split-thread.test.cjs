const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { splitThread, effectiveLength, LIMITS } = require('./split-thread.cjs');

test('splitThread: short text under the limit returns a single post with no numbering', () => {
  const result = splitThread('Hello world, this is a short update.', { platform: 'x' });
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0], 'Hello world, this is a short update.');
  assert.equal(result.truncated, false);
  assert.equal(result.totalInputChars, 'Hello world, this is a short update.'.length);
});

test('splitThread: long paragraph-heavy text splits on paragraph boundaries first', () => {
  const paragraphs = [
    'A'.repeat(200),
    'B'.repeat(200),
    'C'.repeat(200),
    'D'.repeat(200),
  ];
  const text = paragraphs.join('\n\n');
  const result = splitThread(text, { platform: 'x' });
  assert.ok(result.posts.length > 1);
  for (const post of result.posts) {
    assert.ok(post.length <= LIMITS.x, `post exceeds limit: ${post.length}`);
  }
  // Each paragraph landed intact in exactly one post (paragraph boundary
  // respected, not split mid-paragraph since each is <= 280 chars alone).
  for (const paragraph of paragraphs) {
    assert.ok(result.posts.some((post) => post.includes(paragraph)));
  }
});

test('splitThread: single sentence longer than the limit splits at word boundaries only', () => {
  const words = [];
  for (let i = 0; i < 60; i += 1) words.push(`word${i}`);
  const longSentence = `${words.join(' ')}.`;
  const result = splitThread(longSentence, { platform: 'x' });
  assert.ok(result.posts.length > 1);
  for (const post of result.posts) {
    // Strip numbering suffix before checking word integrity.
    const withoutNumbering = post.replace(/\s*\(\d+\/\d+\)$/, '');
    assert.doesNotMatch(withoutNumbering, /word\d\d?-/, 'must not break mid-word');
    for (const token of withoutNumbering.split(/\s+/)) {
      if (token === '') continue;
      assert.ok(
        /^word\d+\.?$/.test(token) || /^\(\d+\/\d+\)$/.test(token),
        `unexpected mid-word fragment: "${token}"`
      );
    }
  }
});

test('splitThread: X platform counts a single long URL as exactly 23 chars', () => {
  const longUrl = `https://example.com/${'a'.repeat(300)}`;
  const text = `Check this out: ${longUrl}`;
  const length = effectiveLength(text, 'x');
  const expected = 'Check this out: '.length + 23;
  assert.equal(length, expected);
});

test('splitThread: X platform counts a short URL as still exactly 23 chars', () => {
  const shortUrl = 'https://x.co/a';
  const text = `See ${shortUrl}`;
  const length = effectiveLength(text, 'x');
  assert.equal(length, 'See '.length + 23);
});

test('splitThread: X platform sums 23 per URL for multiple URLs', () => {
  const text = 'Links: https://one.example.com/path and https://two.example.com/other-path';
  const urls = text.match(/https?:\/\/\S+/g);
  assert.equal(urls.length, 2);
  const length = effectiveLength(text, 'x');
  const withoutUrls = text.replace(/https?:\/\/\S+/g, '');
  assert.equal(length, withoutUrls.length + 23 * 2);
});

test('splitThread: fenced code block is treated as atomic, never split mid-fence', () => {
  const code = '```js\nfunction add(a, b) {\n  return a + b;\n}\n```';
  const text = `${'Intro text. '.repeat(30)}\n\n${code}\n\n${'Outro text. '.repeat(30)}`;
  const result = splitThread(text, { platform: 'threads', maxPosts: 6 });
  const codeHolder = result.posts.find((post) => post.includes('```js'));
  assert.ok(codeHolder, 'code fence must appear in some post');
  assert.ok(codeHolder.includes('```js') && codeHolder.trim().endsWith('```') === false || codeHolder.includes(code));
  // The fence markers must be balanced (even count) within whichever post holds it.
  const fenceCount = (codeHolder.match(/```/g) || []).length;
  assert.equal(fenceCount % 2, 0, 'code fence markers must be balanced, never split mid-fence');
});

test('splitThread: input needing more than maxPosts truncates with truncated=true and trailing ellipsis', () => {
  const text = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} `.repeat(15)).join('\n\n');
  const result = splitThread(text, { platform: 'x', maxPosts: 6 });
  assert.equal(result.posts.length, 6);
  assert.equal(result.truncated, true);
  assert.ok(result.posts[5].includes('…'));
});

test('splitThread: numbering budget is respected — every numbered post stays within the platform limit', () => {
  const text = Array.from({ length: 6 }, (_, i) => `Section ${i}: ${'x'.repeat(270)}`).join('\n\n');
  const result = splitThread(text, { platform: 'x', maxPosts: 6 });
  for (const post of result.posts) {
    assert.ok(effectiveLength(post, 'x') <= LIMITS.x, `numbered post exceeds limit: ${effectiveLength(post, 'x')}`);
  }
  if (result.posts.length > 1) {
    assert.match(result.posts[0], /\(\d+\/\d+\)$/);
  }
});

test('splitThread: threads platform uses the 500-char limit, not X\'s 280', () => {
  const text = 'word '.repeat(80).trim(); // 400 chars, many word boundaries
  const resultThreads = splitThread(text, { platform: 'threads' });
  assert.equal(resultThreads.posts.length, 1);
  const resultX = splitThread(text, { platform: 'x' });
  assert.ok(resultX.posts.length > 1);
});

test('CLI: prints a stderr truncation warning BEFORE the stdout JSON when truncated', () => {
  const text = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} `.repeat(15)).join('\n\n');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'split-thread.cjs'), '--platform', 'x', '--text', text], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /^warning: input exceeds \d+ posts;.*consider shortening/);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.truncated, true);
});

test('CLI: no truncation warning and valid JSON for short input', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'split-thread.cjs'), '--platform', 'threads', '--text', 'short body'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.posts, ['short body']);
});

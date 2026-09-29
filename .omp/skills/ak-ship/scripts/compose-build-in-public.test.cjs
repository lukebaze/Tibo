const assert = require('node:assert/strict');
const test = require('node:test');

const { composeBuildInPublic } = require('./compose-build-in-public.cjs');

test('compose-build-in-public: minimal PR (title only) returns {title, summary, body} with a "Why this?" stub', () => {
  const draft = composeBuildInPublic({ pr: { title: 'Add OAuth2 login flow' } });
  assert.equal(draft.title, 'Add OAuth2 login flow');
  assert.equal(typeof draft.summary, 'string');
  assert.match(draft.body, /## Why this\?/);
  assert.match(draft.body, /# Add OAuth2 login flow/);
});

test('compose-build-in-public: summary redacts a secret that straddles the 140-char truncation boundary', () => {
  // The secret starts at index 130 and runs to 163 — the 137-char summary
  // cutoff lands inside it. Redacting AFTER truncating would slice the
  // secret down to a 7-char fragment ("sk-aaaa"), too short to match the
  // length-gated secret regex, and leak unredacted. Redacting BEFORE
  // truncating (the fix) replaces the whole secret first, so nothing leaks.
  const secret = `sk-${'a'.repeat(30)}`;
  const prefix = 'x'.repeat(130);
  const why = `${prefix}${secret} and more trailing text that pushes this well past the summary's cutoff.`;
  const draft = composeBuildInPublic({ pr: { title: 'Ship it' }, issue: { body: why } });
  assert.doesNotMatch(draft.summary, /sk-a+/);
  assert.match(draft.summary, /\[redac/);
});

test('compose-build-in-public: linked issue body feeds "Why this?" before the PR body', () => {
  const draft = composeBuildInPublic({
    pr: { title: 'Fix flaky test', body: 'PR body paragraph — should not be used for Why.' },
    issue: { body: 'Users report intermittent CI failures on the auth suite.\n\nMore detail below.' },
  });
  assert.match(draft.body, /Users report intermittent CI failures on the auth suite\./);
  assert.doesNotMatch(draft.body.split('## What changed')[0], /should not be used for Why/);
});

test('compose-build-in-public: journal-entry blockers render "The tricky bit" section', () => {
  const draft = composeBuildInPublic({
    pr: { title: 'Ship feature X' },
    journalEntries: [{ blockers: 'The webhook retried indefinitely until we added a backoff cap.' }],
  });
  assert.match(draft.body, /## The tricky bit/);
  assert.match(draft.body, /backoff cap/);
});

test('compose-build-in-public: no blockers omits "The tricky bit" section entirely (no empty stub)', () => {
  const draft = composeBuildInPublic({ pr: { title: 'Ship feature Y' }, journalEntries: [] });
  assert.doesNotMatch(draft.body, /## The tricky bit/);
});

test('compose-build-in-public: --writing-style wiring via MOCK_STYLE_TRANSFORM', () => {
  const prevEnv = process.env.MOCK_STYLE_TRANSFORM;
  process.env.MOCK_STYLE_TRANSFORM = '1';
  try {
    const draft = composeBuildInPublic({ pr: { title: 'Ship feature Z' }, writingStyle: 'casual' });
    assert.match(draft.body, /<!-- style: casual -->/);
  } finally {
    if (prevEnv === undefined) delete process.env.MOCK_STYLE_TRANSFORM;
    else process.env.MOCK_STYLE_TRANSFORM = prevEnv;
  }
});

test('compose-build-in-public: pure function — same inputs produce identical outputs, no I/O', () => {
  const context = {
    pr: { title: 'Ship feature W', body: 'Body paragraph.' },
    issue: { body: 'Issue paragraph.' },
    plan: { overview: 'Plan overview.', nextPhase: 'Phase 4: polish.' },
    journalEntries: [{ blockers: 'A blocker.' }],
    collaborators: ['alice', 'bob'],
  };
  const first = composeBuildInPublic(context);
  const second = composeBuildInPublic(context);
  assert.deepEqual(first, second);
});

test('compose-build-in-public: redacts a JWT from the draft body', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQrZ8xJ4v3f1lQwZ8Z3v3f1lQwZ8Z3v3f1';
  const draft = composeBuildInPublic({ pr: { title: 'T', body: `Leaked token: ${jwt}` } });
  assert.doesNotMatch(draft.body, new RegExp(jwt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(draft.body, /\[redacted\]/);
});

test('compose-build-in-public: redacts an AWS access key id (AKIA...)', () => {
  const key = 'AKIAABCDEFGHIJKLMNOP';
  const draft = composeBuildInPublic({ pr: { title: 'T', body: `Key: ${key}` } });
  assert.doesNotMatch(draft.body, new RegExp(key));
  assert.match(draft.body, /\[redacted\]/);
});

test('compose-build-in-public: redacts a Slack bot token (xoxb-...)', () => {
  const token = 'xoxb-1234567890-abcdefghijklmnop';
  const draft = composeBuildInPublic({ pr: { title: 'T', body: `Token: ${token}` } });
  assert.doesNotMatch(draft.body, new RegExp(token));
  assert.match(draft.body, /\[redacted\]/);
});

test('compose-build-in-public: redacts GitHub PATs (ghp_ and github_pat_)', () => {
  const classic = `ghp_${'a'.repeat(36)}`;
  const fineGrained = `github_pat_${'B'.repeat(22)}_${'c'.repeat(59)}`;
  const draft = composeBuildInPublic({ pr: { title: 'T', body: `Classic: ${classic}\nFine: ${fineGrained}` } });
  assert.doesNotMatch(draft.body, new RegExp(classic));
  assert.doesNotMatch(draft.body, new RegExp(fineGrained));
});

test('compose-build-in-public: redacts an OpenAI-style key (sk-proj-...)', () => {
  const key = `sk-proj-${'a1B2'.repeat(6)}`;
  const draft = composeBuildInPublic({ pr: { title: 'T', body: `Key: ${key}` } });
  assert.doesNotMatch(draft.body, new RegExp(key));
  assert.match(draft.body, /\[redacted\]/);
});

test('compose-build-in-public: redacts a URL-embedded token while keeping the prefix', () => {
  const draft = composeBuildInPublic({
    pr: { title: 'T', body: 'Webhook: https://example.com/hook?api_key=supersecretvalue123' },
  });
  assert.doesNotMatch(draft.body, /supersecretvalue123/);
  assert.match(draft.body, /https:\/\/example\.com\/hook\?api_key=\[redacted\]/);
});

test('compose-build-in-public: redacts a PEM private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----';
  const draft = composeBuildInPublic({ pr: { title: 'T', body: `Key:\n${pem}` } });
  assert.doesNotMatch(draft.body, /MIIBOgIBAAJBAK/);
  assert.match(draft.body, /\[redacted\]/);
});

# Release and Social Workflow

Load this reference for Steps 6-9 and optional Step 14. The main ship workflow
owns ordering and the Step 13 terminal-state gate.

## Step 6: Version bump

1. Auto-detect the version source via `auto-detect.md`; skip when absent.
2. Default to patch for ordinary diffs. Ask whether to use minor or patch for a
   major feature or breaking change.
3. For beta mode, use the next prerelease suffix such as `1.2.4-beta.1`.
4. Write the selected version to the detected source.

## Step 7: Changelog

1. Find `CHANGELOG.md` or `CHANGES.md`; skip when absent.
2. Infer the entry from all target-to-head commits and the full diff. Do not ask
   the user to restate changes.
3. Categorize Added, Changed, Fixed, and Removed; insert a dated version entry
   after the file header.

## Step 8: Journal

Apply the shared **Journal step — opt-out** contract. Skip when
`--skip-journal` is present, or when this command returns the exact string
`false`:

```bash
ak config prefs resolve --json | jq -r 'if .prefs.journal.auto == false then "false" else "true" end'
```

Command errors or any other output default to enabled. Precedence: flag,
project config, user config, then `true`.

Print `journal skipped by --skip-journal` or `journal skipped by preference`
when skipped. Explicit `/ak:journal` and `ak journal create` remain unaffected.

Otherwise invoke `/ak:journal` via a `journal-writer` subagent in the
background. Include shipped changes, decisions, and technical challenges; save
the chronological record under `./plans/journals/`. Continue without waiting.

## Step 9: Docs update

Skip for `--skip-docs` or beta mode. Otherwise invoke `/ak:docs update` via a
`docs-manager` subagent in the background and continue without waiting.

## Step 14: Social publish

Skip unless `--social` is present. Also skip when `--skip-journal` is present;
every social post requires a durable journal entry. `journal.auto=false` does
not suppress this explicit opt-in.

1. Require green PR checks before composing or posting. Pending or failing
   checks stop this step.
2. Query repository visibility. A private repository requires
   `--social --yes-post --yes-post-private`; otherwise refuse publishing.
3. Ingest only review bodies whose author association is `COLLABORATOR`,
   `MEMBER`, or `OWNER`:

   ```bash
   gh api "repos/$OWNER/$REPO/pulls/<pr-number>/reviews" \
     --jq '.[] | select(.author_association == "COLLABORATOR" or .author_association == "MEMBER" or .author_association == "OWNER") | .body' \
     > /tmp/pr-collaborator-notes.md
   ```
4. Resolve and run the installed-first composer:

   ```bash
   COMPOSE_BIN="$HOME/.claude/skills/ak-ship/scripts/compose-build-in-public.cjs"
   test -f "$COMPOSE_BIN" || COMPOSE_BIN=kits/engineer/skills/ak-ship/scripts/compose-build-in-public.cjs
   gh pr view <pr-number> --json body -q .body > /tmp/pr-body.md
   node "$COMPOSE_BIN" \
     --pr-title "<PR title>" \
     --pr-body-file /tmp/pr-body.md \
     --journal-blockers-file /tmp/pr-collaborator-notes.md \
     --writing-style "<resolved journal.writing_style, if any>" \
     --output /tmp/build-in-public-draft.md
   ```

5. Persist the draft through `ak journal create` before any post:

   ```bash
   ak journal create "$(head -1 /tmp/build-in-public-draft.md | sed 's/^# //')" \
     --summary "<one-line summary from composer JSON>" \
     --stdin < /tmp/build-in-public-draft.md
   ```

6. Resolve the installed-first publisher:

   ```bash
   POST_BIN="$HOME/.claude/skills/ak-journal/scripts/post-social.cjs"
   test -f "$POST_BIN" || POST_BIN=kits/core/skills/ak-journal/scripts/post-social.cjs
   ```

7. Without `--yes-post`, render every configured build-in-public channel and
   make no API call:

   ```bash
   node "$POST_BIN" \
     --journal-file "$JOURNAL_PATH" \
     --channels build_in_public \
     --dry-run --json
   ```

   If `groups.build_in_public` is absent, omit `--channels build_in_public` to
   target all configured channels. Show the rendered posts and require a rerun
   with `--social --yes-post` to publish.

8. With `--yes-post`, publish using the same resolved journal and channels:

   ```bash
   node "$POST_BIN" \
     --journal-file "$JOURNAL_PATH" \
     --channels build_in_public --json
   ```

   Report status and URL per channel. If a platform rejects media, post
   text-only with `MEDIA_UNSUPPORTED` rather than failing every channel.

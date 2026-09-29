# llms.txt / llms-full.txt

Generate or update **both** `llms.txt` and `llms-full.txt` for this project per
the [llmstxt.org](https://llmstxt.org) specification. These files orient AI
agents at inference time; they are not SEO, robots.txt, or crawl-control
artifacts.

## Goal

Produce a curated machine-readable docs index (`llms.txt`) and a full-content
companion (`llms-full.txt`) so agents can discover and load project
documentation efficiently.

## 1. Discover the source of truth

1. Find the project's docs route via the Discovery Contract in the parent skill
   (`AGENTS.md`/`CLAUDE.md`, root `README.md`, docs index/nav, then `docs/`).
2. Treat the discovered docs route as source of truth — by convention `docs/`.
3. Prefer stable public `.md` URL variants when the project serves a docs site
   (e.g. `page.html.md` or `page.md`). Otherwise use repo-relative paths to the
   markdown sources.
4. Skip marketing copy, nav boilerplate, forums, ads, archived versions, and
   duplicate pages. Keep citation-worthy current docs only.

## 2. Choose the output location

Write both files to:

- the site's public/static directory when the project serves one
  (e.g. `public/`, `static/`, framework `out/` / `dist/` when that is the
  published root), otherwise
- the repository root.

Place `llms.txt` and `llms-full.txt` side by side in that location.

## 3. Update in place (do not regenerate blindly)

When either file already exists:

1. Read the current file and the current docs tree.
2. **Add** entries for new pages.
3. **Drop** entries whose pages were deleted or relocated with no replacement.
4. **Keep** curated section ordering and human-written notes unless evidence
   shows they are wrong.
5. Reconcile titles, URLs, and one-line notes against current docs.

Only create from scratch when neither file exists.

## 4. `llms.txt` grammar (exact)

`llms.txt` is plain-text Markdown. Follow this ordered structure exactly:

```markdown
# Project Name

> One-line summary of the project.

Optional prose paragraphs or lists with key context.
No headings allowed in this prose block.

## Section Name

- [Page title](url): one-line note
- [Another page](url): one-line note

## Optional

- [Secondary page](url): one-line note
```

Rules:

| Element | Requirement |
|---|---|
| H1 | **Required.** Exactly one `#` with the project/site name. |
| Blockquote | One-line (or short) summary after the H1. Use `> …`. |
| Optional prose | Zero or more paragraphs/lists **without any headings**. |
| H2 sections | Group related links. Each item: `- [title](url): one-line note`. |
| `## Optional` | Last H2. Agents may skip these entries when context is short. Put changelogs, legacy, and supplementary links here. |

Hard constraints for `llms.txt`:

- Links and one-line notes only — **never** inline page content.
- Every note is a single concise line after `: `.
- No duplicate URLs or titles across sections.
- Keep the index small (typically tens of KB) so it fits agent context.

## 5. `llms-full.txt` content

`llms-full.txt` inlines the full documentation content in the same reading order
as the curated sections in `llms.txt` (core sections first; optional last or
omitted when size is a concern).

For each page, include clean Markdown body (no HTML chrome, nav, or ads),
preserve a clear heading hierarchy, and keep the canonical source URL
discoverable (e.g. as a heading link).

Size guidance (from llmstxt.org practice):

| Size | Guidance |
|---|---|
| <200 KB | Comfortable for most agent queries |
| 200 KB–1 MB | Prefer for focused/deep queries |
| 1–2 MB | Near typical context limits; agents may chunk |
| >2 MB | May exceed agent context — warn, trim non-essential pages, or expect fallback to `llms.txt` |

Exclude changelogs, forums, and archived versions from the full file unless the
user explicitly requests them. Prefer essential, citation-worthy content.

## 6. Generation path

When the engineer `ak:llms` skill and its `generate-llms-txt.py` script are
installed in this environment, you MAY delegate generation to it:

```bash
# from the installed ak-llms skill directory
# index only
../ak-llms/scripts/generate-llms-txt.py --source <docs-route> --output <output-dir> [--base-url <url>]

# index + full content
../ak-llms/scripts/generate-llms-txt.py --source <docs-route> --output <output-dir> --full [--base-url <url>]
```

After delegation: curate section order, one-line notes, the `## Optional` split,
and drop noise the script included. Do not ship raw generator output unreviewed.

Otherwise write both files manually from the discovered docs route, following
sections 4–5.

## 7. Validate before finishing

Confirm all of the following:

1. Both `llms.txt` and `llms-full.txt` exist at the chosen output location.
2. `llms.txt` has the required H1, a blockquote summary, valid H2 link sections,
   and `## Optional` last when secondary links exist.
3. Every link resolves (public URL reachable, or repo-relative path exists).
4. Every entry has a one-line note; no blank or multi-paragraph notes in
   `llms.txt`.
5. No duplicate entries (same URL or same title repeated).
6. `llms.txt` contains no inlined page bodies.
7. `llms-full.txt` reading order matches the curated index; note if the file is
   large enough that agents may exceed context.

Report output paths, entry counts, approximate `llms-full.txt` size, and any
unresolved links or skipped pages.

## Additional requests
<additional_requests>
  $ARGUMENTS
</additional_requests>

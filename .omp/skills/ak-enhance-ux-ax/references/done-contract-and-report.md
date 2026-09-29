# Report and DONE contract

Write the report to the project's configured reports directory (default
`plans/reports/`) as `enhance-ux-ax-<YYMMDD-HHmm>-<slug>.md`, with evidence in a
sibling folder `enhance-ux-ax-<YYMMDD-HHmm>-<slug>/round-<n>/`. Name screenshots
`<viewport>-<page>-<state>.png`, for example `mobile-home-loaded.png`.

## Report template

```markdown
# UX/AX review: <project> — <date>

## Verdict
<two or three sentences: the biggest win available and current DONE status>

## Scope and environment
Mode, focus, URL or dev command, commit, pages reviewed, checks that could not run.

## Baseline evidence
Screenshot table per page × viewport; discovery-scan summary (errors, warnings).

## Scores
| Area | Score 0–3 | Evidence |

## Proposals
### P1 — <title> (Must)
- Evidence: <screenshot / scan finding / file:line>
- Change: <what and where>
- Files: <paths>
- Acceptance: <observable checks>

## DONE contract
<the checklist below, filled in for this project>

## Round log (auto/loop only)
| Round | Proposals done | Checks passing | Regressions fixed | Notes |

## Unresolved questions
```

## Proposal rules

- Must: breaks trust, comprehension, accessibility, or a discovery surface is
  missing or wrong. Should: clear gain in recall, clarity or conversion. Could:
  polish or experiment.
- One proposal per coherent change; split when two parts can ship independently.
- Acceptance checks are observable: a command and its expected result, a
  screenshot state, a measured value, or a file containing specific content.
  "Looks better" is not a check.

## Project DONE contract

Implementation is DONE only when every line is true and evidenced in the report:

1. Every Must and Should proposal meets its acceptance checks; each skipped item
   has a stated reason accepted in the report.
2. `check-discovery-surfaces.mjs` exits 0 against the running site (with
   `--site-origin` when that is a dev server or preview) and checked more than the home
   page whenever the sitemap lists other pages; every remaining warning is either
   fixed or listed with the reason it is accepted.
3. Screenshots at 1440×900, 768×1024 and 375×812 of every changed page show no
   horizontal overflow, clipped text, overlapping elements or broken images, and the
   vision review finds no High issue.
4. No rubric area regressed from baseline; each area that scored below 2 now
   scores at least 2, or its gap is recorded as an unresolved question.
5. Keyboard and reduced-motion checks pass on changed interactive elements.
6. The project's build, lint and tests pass, or failures are shown as pre-existing
   with evidence.
7. `DESIGN.md`, `REVIEW.md` and `AGENTS.md` reflect the delivered direction and
   checks, with prior content preserved.
8. Dev servers and other processes started by the review are stopped.

Default mode ends at report DONE (see SKILL.md); it lists this contract as the
target but does not claim it.

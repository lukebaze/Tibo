# Workflow Routing

Use this file when choosing the sequence for multi-step work. It is a routing
map only; load the owning `SKILL.md` before executing details.

## Core Sequences

| User intent | Sequence |
|---|---|
| Implement a feature | `/ak:brainstorm` -> `the engineer plan skill` -> `/ak:cook` -> `the installed test skill` -> `the installed code-review skill` |
| Execute an accepted plan | reuse its brainstorm contract -> `/ak:cook <plan-path>` |
| Quick implementation | bounded brainstorm gate -> `/ak:cook --fast` |
| Bug, error, failed test, or CI failure | opening intent frame -> `/ak:fix` |
| Investigate before deciding | `/ak:scout` -> `the engineer debug skill` -> `/ak:brainstorm` -> `the engineer plan skill` |
| Review a PR | `the installed review-pr skill <PR>` |
| Fix review feedback | `the installed review-pr skill <PR> --fix` or `/ak:fix --parallel` |
| Ship a completed branch | `the engineer ship skill` |
| Explain work visually | `/ak:preview --explain` or `/ak:preview --html --diff` |
| Update project docs | `/ak:docs update` |

## Implementation Owner

- Start delivery with outcome, constraints, non-goals, and acceptance criteria.
  Reuse them from an accepted plan instead of asking again.
- Use `/ak:cook` for known feature scope after requirements are clear.
- Use `/ak:fix` for concrete bugs, errors, test failures, and CI failures.
- Use `the engineer plan skill` when work needs architecture, phases, file ownership, or TDD
  structure.
- Use `the installed test skill` for verification-only work.
- Use `the engineer ship skill` only after implementation, tests, and review are done.
- Read-only scout, debug, review, and explanation work may stop without an
  interactive design loop. Satisfy the brainstorm gate if it crosses into
  delivery or workspace mutation.

## Handoff Rules

- Establish the brainstorm contract, then use the domain skill for evidence and
  design, followed by the workflow owner. Example: for a React feature, route
  to `the installed frontend-development skill`, then execute through the
  installed plan skill and `/ak:cook`.
- For visual explanations, invoke the installed preview skill and follow its
  explanation routing.
- For documentation changes, invoke `/ak:docs update` and follow the installed
  documentation-management routing.
- If `find-skills` is installed and skill choice is ambiguous, invoke it for
  domain routing. Otherwise use the installed skill names and descriptions.

## Post-Implementation

- Review high-risk, cross-module, or public-contract changes before shipping.
- Update docs only when behavior, setup, commands, architecture, security
  posture, public contracts, or future maintainer decisions changed.
- Journal when a workflow creates durable decisions or debugging lessons.

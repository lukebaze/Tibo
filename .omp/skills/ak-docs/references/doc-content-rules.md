# Doc Content Rules

Load this file before generating or updating documentation. Include the
relevant ownership, drift-resistance, and authority rules in every docs-manager
delegate prompt because delegated contexts are isolated.

Root agent context files (`CLAUDE.md`/`AGENTS.md`) are process memory, not
WHY/WHERE docs; follow `agent-context-rules.md` for those. This file's deletion
test and drift-resistance rules are the shared spine both operations rely on.

## Ownership Rule

Code owns WHAT and HOW. Docs own only WHY and WHERE.

- WHY: decisions, rejected alternatives, trade-offs, business rules, domain
  terminology, and constraints code cannot express.
- WHERE: navigation to entry points, module boundaries, and executable owners.
- WHERE (outside the repository): the retrieval route to an external system
  whose state lives outside the repository — where its logs are, how a
  credential is retrieved, how the running deployment is discovered, and which
  approval path applies.

Never write prose that re-describes implementation behavior. It creates a
second source of truth that is not executable or testable. Point to source,
tests, schemas, manifests, generators, or workflows instead.

## The Deletion Test

For every sentence, ask:

1. If an agent read the executable owner, would it learn this anyway? If yes,
   delete the sentence or replace it with a pointer.
2. If the team vanished, could this rationale, constraint, or terminology be
   recovered from the repository? If no, keep and clarify it.
3. If a consumer can only learn this by being told, and the repository cannot
   prove it, keep it in its owning route record instead of deleting it.

The exception covers the retrieval route, never the retrieved state: a current
deployment revision, a dashboard snapshot, an account inventory, or a secret
value is not protected by it.

## Write Authority

Maintenance inside an authorized scope is self-authorized when it is routine.
Confirmation is required only for the non-routine edits below.

| Tier | Edits |
|---|---|
| Routine (self-authorized) | Correcting a path, command, or route that current evidence proves false; refreshing a record whose target moved; removing a duplicate of a route owned elsewhere; adding the first record for a route an authorized action just established, together with the minimal navigation pointer to it. |
| Non-routine (confirm first) | Replacing hand-written prose; replacing an existing owning document; changing a user's prior correction; granting or widening access; a refresh that enlarges the authorized actions, scope, or audience a record states; changing an approval path or quality gate; broadening the audience of a destination. |

A refresh is routine only while it leaves the authorized actions, scope, and
audience exactly as they were: that field is the authority a later reader acts
on, so enlarging it is a grant in effect. When provenance is unknown and current
evidence contradicts the recorded text, propose the change instead of writing it.

A minimal navigation pointer is one line: a link plus a purpose clause. It is
never a locator, URL, account or project id, or customer name.

Recording a credential value is never authorized, with or without confirmation.
A secret is never written into a document, an agent context file, a report, a
proposed diff, a commit, a PR or issue body, a conversation, or a URL,
regardless of who approves it.

Self-authorized maintenance may only describe access that already exists and was
granted elsewhere. When routine and non-routine changes appear in the same edit,
the whole edit is non-routine. A workflow that declares its own confirmed-change
contract keeps it: the interview modes, `--audit`, and the `agents` mining
operation confirm before writing, and `--advice` adds counsel without adding a
second confirmation for a routine change.

Personal data observed along the way follows the credential boundary rather than
the retention exception: minimize and redact it before it is retained, delegated,
or published, including in receipts, log excerpts, error output, and proposed
diffs. `operational-lookup.md` elaborates this for route work.

### Destination ownership

Before writing, resolve the destination's real path. A destination whose file or
parent directory is a symlink or junction, or whose resolved path falls outside
the project, requires explicit authorization; otherwise report a sanitized
proposed change instead of writing it.

## Drift-Resistance Rules

1. Point, do not paraphrase. Prefer a stable path plus symbol or named heading.
2. Never copy code, signatures, config bodies, mutable inventories, or command
   output into prose. An example may remain only when it teaches a decision.
3. Do not hand-maintain counts, percentages, LOC tables, file trees, or support
   matrices. Link to their machine owner or provide the command that discovers
   them.
4. Distill current rationale into the repository's canonical decision surface.
   Remove obsolete or superseded prose; Git history preserves the long form.
5. Every current claim must be either mechanically checkable or a durable
   decision/domain fact. A claim falsifiable by an implementation rename needs
   an executable owner, not a rewritten paragraph.
6. If review exposes an unwritten rejection rule, record it once in the
   canonical review or engineering-rules surface.
7. Do not create ADRs, changelog entries, roadmaps, generators, bots, or
   docs-only gates unless the user or repository contract explicitly requires
   that operating surface.

## Repository-Specific Authority

Do not impose stable filenames across projects on your own initiative.
Discover authority from repository instructions, the root README, and existing
docs navigation. Choose the smallest set of real information boundaries.

A fixed layout is legitimate when the project or the user asks for one, through
a route declared in repository instructions or through `--preset classic` on
`init`. Honour that choice for filenames only. The rules in this file still
govern what goes inside each file, so a requested layout never authorizes
implementation paraphrase, placeholder files, or hand-maintained inventories.

When the repository designates them:

- the root collaborator guide owns safety-critical invariants and navigation;
- a reviewer playbook owns judgment calls, hard rejections, and historical
  scars;
- code standards own engineering choices, testing policy, naming, quality, and
  contribution constraints;
- system architecture owns current boundaries and a compact decision ledger;
- a project overview owns product intent, non-goals, terminology, and business
  constraints;
- a codebase summary is navigation only, never per-file description;
- operational guides own provider quirks and runbooks not expressible in code.

Keep glossary and navigation separate and thin only when they are genuinely
needed. Do not create placeholders to complete a template.

## Sizing

WHY docs are naturally short. A short honest navigation or rationale document
is better than implementation paraphrase. Split only at real semantic
boundaries and never pad.

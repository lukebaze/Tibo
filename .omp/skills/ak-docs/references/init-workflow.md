# Init Workflow

Use this workflow to establish project documentation without imposing a
template inherited from AgentKit. Read `doc-content-rules.md` before
authoring or delegating document changes. When the docs being authored include
test-related guidance (how to set up, run, or structure tests), also load
`../../ak-test/references/practical-principles-for-setting-up-and-running-tests.md` and apply
it; keep the result project-specific and evidence-backed.

## 1. Brainstorm the docs contract

Run the opening gate from the parent skill. Capture audience, intended
decisions, authority, evidence, scope, and acceptance criteria.

## 2. Inspect the project

- Read repository instructions and the root README first.
- Discover existing docs, plans, generated references, and navigation with
  repository search tools.
- Scout the relevant source and tests. Skip credentials, caches, dependencies,
  generated bundles, and unrelated external trees.
- Extract entry points, boundaries, decisions, alternatives, domain rules, and
  cross-file constraints without copying mutable implementation details.
- Identify which information is evergreen and which is a stateful record.

## 3. Design the smallest useful route

When `--preset classic` is set, the filenames are already chosen. The preset
replaces the route design below, not the content rules, and each file keeps the
role defined under Repository-Specific Authority in
`doc-content-rules.md`:

- `docs/project-overview-pdr.md` — product intent, non-goals, terminology, and
  business constraints.
- `docs/code-standards.md` — engineering choices, testing policy, naming,
  quality bars, and contribution constraints.
- `docs/codebase-summary.md` — navigation only: entry points, module
  boundaries, and executable owners. Never a per-file or per-function tour.
- `docs/design-guidelines.md` — design language, tokens, and interface
  conventions that source alone does not explain.
- `docs/deployment-guide.md` — environments, deploy targets, and runbook
  pointers to the workflows and scripts that own each step.
- `docs/system-architecture.md` — current boundaries and a compact decision
  ledger.
- `docs/project-roadmap.md` — intended direction, labelled as intent rather
  than shipped behavior.

Skip any preset file whose information does not exist in the project, say which
files you skipped and why, and record the final route in the docs index so
`update` and `summarize` reuse it. Then continue from step 4.

Otherwise, choose files by information role, not by an inherited template. A small
project may need one routed document. A larger project may separate product
intent, current decisions, workflow, architecture, machine contracts, and
operations when those boundaries are real.

- Reuse an existing route when it is coherent.
- Add an index only when multiple documents need navigation.
- Do not create empty placeholders, speculative roadmaps, or an ADR collection
  merely to complete a template.
- Keep machine-owned inventories in a manifest or generator output and link to
  that owner from prose.

When the scope includes agent onboarding or operational documentation, discover
existing operational routes first, then keep or create a short maintenance
policy in the agent context file plus a pointer to the owning operational guide.
Do not require `docs/deployment.md`, `docs/secrets.md`, or `docs/logs.md` to
exist for completeness, and do not forbid them when there is information worth
keeping. Load the sibling `operational-lookup.md` and record one route record per
route. If the requested scope is a narrow documentation area, do not rewrite the
root policy outside that scope.

Present the proposed route before writing when it would replace existing docs
or materially change authority.

## 4. Author with evidence

Use `docs-manager` through the runtime's delegation capability when available;
otherwise perform the same evidence-first work locally. Pass the brainstormed
contract, discovered routes, evidence map, exact files to retain, replace, or
remove, and relevant rules from `doc-content-rules.md`.

If the project has little discoverable WHY, write short docs. Never pad with
implementation paraphrases.

## 5. Validate

- Verify internal links and referenced paths.
- Run examples or owning scripts where practical.
- Confirm current claims against source, tests, artifacts, or live state.
- Check that no fixed inventory or copied command sequence gained a second
  maintenance owner.
- Confirm that no operational route gained a second owner, that each recorded
  route carries scope, permission, and a verification step, and that the
  destination's audience permits what was recorded.
- Report created, changed, retained, and removed authority surfaces.

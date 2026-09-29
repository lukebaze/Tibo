# Task Taxonomy

Classify before routing. Output of this step is one workflow class plus three
modifiers. The class picks the default route shape; the modifiers bend it.
When a task spans classes, pick the class of the FINAL deliverable and treat
the others as links inside its chain.

These route shapes begin only after the bounded outcome gate owned by
`../../../rules/primary-workflow.md`. They must not bypass or duplicate that
opening contract.

## Workflow Classes

| Class | Signals (user phrasing) | Default route shape |
|---|---|---|
| build-feature | "implement / add / build X", new capability | scout → plan (size ≥ standard) → execute (domain skill under implementation skill) → verify (test) → review (elevated+ risk) |
| fix-defect | "broken / error / bug / failing / CI red" | fix skill directly (it scouts internally); debugger role after two failed attempts; verify with test link |
| investigate-explain | "why / how does / understand / compare / what happens if" | scout → analysis (debug or ask skill) → report findings; no mutation links; explorer roles in parallel when >2 areas |
| review-audit | "review / audit / check quality / security posture" | review or audit skill → verified findings report; independent reviewer role for cross-module or security scope |
| ship-release | "ship / open PR / release / publish the branch" | verify state (tests green, diff reviewed) → ship skill; reviewer role BEFORE this class starts, not during |
| create-content | "write / draft / post / email / landing copy" | voice/brand input → writing skill → SEO link (if organic reach) → content-reviewer role → publish/schedule link |
| discover-validate | "market research / competitor analysis / validate an idea / what should I build", product owner or founder framing | research → competitor → decide (brainstorm) → demand test → plan → record; on installs shipping a playbook skill, its product-discovery template (see chaining-patterns marketing sequences) |
| plan-campaign | "campaign / launch / funnel / go-to-market" | research → persona/funnel → campaign brief → per-channel production → analytics setup (see chaining-patterns marketing sequences) |
| analyze-performance | "metrics / traffic / conversion / report on / trends" | analytics skill → analysis → recommendations report; analyst role for large data pulls |
| design-visual | "mockup / logo / banner / diagram / UI design" | design or visual skill per artifact type; designer role for iteration batches; reviewer only when brand-critical |
| operate-infra | "deploy / docker / kubernetes / database ops / backup" | ops skill for the platform → verify link (health check, dry-run first when destructive) |
| document | "document / readme / changelog / update docs" | docs skill → accuracy check against the change that triggered it |
| meta-capability | "is there a skill for / can you X / extend tooling" | find-skills (if installed) → install → re-route the original task |

Class names are stable vocabulary for the routing record; the skills filling
each slot come from the Step 2 inventory, never from this table.

## Modifiers

### Size

| Size | Test | Effect on route |
|---|---|---|
| trivial | One file or artifact, < 30 min, no unknowns | Collapse to a single skill or inline work; skip planning; no subagents |
| standard | One deliverable, few files, minor unknowns | Default shape as-is |
| epic | Multiple deliverables or subsystems, real unknowns | Insert planning link; split execution into phases; delegate phases to implementer roles with disjoint file ownership |

### Risk

| Risk | Test | Effect on route |
|---|---|---|
| low | Internal, reversible, no audience | Executor's own checks suffice |
| elevated | User-visible behavior, cross-module reach | Add verify link + self-review of diff/draft |
| high | Public contract, security, credentials, data migration, money, destructive op, mass-audience send | Add verify link + independent reviewer role + explicit user confirmation before the irreversible step |

Risk is set by the highest-risk link in the chain, not the average.

### Domain count

| Domains | Effect |
|---|---|
| 1 | Single domain skill owns execution |
| 2+ | One domain-skill link per domain, sequenced by dependency; the workflow skill owns the spine; never let two domain skills co-own one link |

## Ambiguity Rule

If two classes fit equally after reading the signals, prefer the one whose
default shape is shorter, and say so in the routing record. Upgrading a route
mid-task on new evidence is cheap; unwinding ceremony is not.

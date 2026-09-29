# Prompt Cruft Patterns
<!-- cruft-lint-allow: this file names the patterns the linter reports -->

Prompt cruft is instruction text whose cost or harm is supported by evidence on
the target consumers. This catalog identifies candidates for review; pattern
matches alone do not establish that a constraint is obsolete. Keep accepted
contracts and test behavior before removing guidance.

`scripts/lint_cruft.py` implements the signals below. It reports and never
edits. Rule ids in the table match the script's `--json` output.

## Classify by function before you judge

The same words mean different things in different places.

- **Routing text** (`description`, `when_to_use`, keyword lists) describes the
  owned task and activation boundary. With `--routing`, YAML-aware checks report
  advisory pressure and scope signals separately from body rules. A precise
  "whenever" condition is not itself a defect. Judge activation with real traces.
- **Behavioral text** (the SKILL.md body, references, agent bodies, output
  styles, hook text injected into context) must explain, not shout. Every
  rule below applies here.
- **Fragile scripts** (destructive commands, auth flows, compliance steps)
  keep their exact wording. Mark the block with `<!-- fragile -->` so the
  linter skips it.

## Pattern table

| Rule id | Level | Signal | Risk to investigate | Replacement |
|---|---|---|---|---|
| `routing-pressure` | Low | Metadata demands activation regardless of scope | Can crowd out a better matching skill | State owned work and activation conditions |
| `routing-keyword-scope` | Low | Activation tied to several generic keyword mentions | May include unrelated work; review against the competing catalog | Describe the actual task |
| `routing-metadata-format` | High | Invalid YAML or routing field types under `--routing` | Metadata cannot be inspected reliably | Repair metadata under the typed contract |
| `verification-ritual` | Low | Generic double-check or verify-twice instructions without a condition/reason | May duplicate successful checks | State completion evidence and when rechecking is needed |
| `approval-loop` | Medium | Approval or confirmation before/after each step or phase | Blanket checkpoints may ask again inside already-authorized scope; explicit interactive and destructive gates remain valid | Reuse authorization and ask for material missing decisions or new effects |
| `blanket-full-read` | Medium | Read all docs/references or the entire specification without a stated reason | Unconditional loading may hide the relevant contract inside unrelated context | Select the owning guide; preserve complete reads required by fragile operations |
| `fenced-reasoning` | Medium | `Thought N/M`, thinking tags, or requests to output internal reasoning in text/Markdown fences | Prompt examples may impose a transcript even when surrounding prose does not | Record decisions, observations and uncertainty; preserve exact fixtures with a scoped exemption |
| `pressure-density` | High at 8+ per file or 3 in any 10 lines; Medium at 4+ | MUST, NEVER, ALWAYS, CRITICAL, IMPORTANT, MANDATORY in body text | Stacked emphasis may over-trigger; test whether a protected instruction still needs emphasis | State the rule once at normal volume with its reason |
| `emphasis-no-reason` | Medium | A pressure word with no "because", "so that", or "otherwise" within two lines | Emphasis without a reason cannot be applied with judgment | Add the reason or drop the emphasis |
| `threat-language` | High | "INCOMPLETE", "DO NOT … yourself", "never skip", "MANDATORY —" | Threats produce compliance theatre (spawning agents for a typo fix) rather than judgment | Say when the step matters and why a fresh context helps |
| `report-compression` | High | "sacrifice grammar" | Current models already write densely; fragments and arrow chains are the documented readability failure | "Lead with the outcome; keep it short by being selective, in complete sentences" |
| `token-booster` | High | "ensure token efficiency", "be extremely concise" | Effort and token use are model configuration, and the phrase trims exactly the reasoning you want | Delete |
| `delegation-suppressor` | High | "avoid spawning", "do not delegate", "only delegate when", "can cause performance issues" | Unexplained suppression may block useful work; explained capability, authorization, ownership and resource constraints are exempt | Describe the delegation contract (scoped prompt, files it may touch) instead |
| `numeric-cap` | Medium | "at most N words/sentences/bullets", "N sentences max", "under N words", "every N tool calls" | Arbitrary caps may reduce useful evidence; explicit user limits and real operating budgets remain valid | Describe the reader and the purpose; keep true format requirements |
| `duplicate-line` | Medium | The same prose instruction appears twice in one file | The model reconciles two wordings and pays for it every turn | Keep one instance; one closing recap is enough |
| `step-choreography` | Low | Four or more "Step N" headers with no statement that order matters | Incidental choreography may constrain judgment; dependencies and reliable procedures can require order | Outcome, constraints, verification; number steps when order encodes dependencies, reliability or safety |
| `prohibition-run` | Medium | Three or more consecutive lines starting with "Do not", "Never", "Avoid" | Lists of style prohibitions were fixes for older models' habits | One sentence describing the desired result, with a reason for any rule kept |
| `thinking-scaffold` | High | "think step by step", `<scratchpad>`, `<thinking>`, "take a deep breath", "ultrathink", "think hard/harder/deeply/more", "**Thinking level:**" | Adaptive thinking replaces manual scaffolds and the scaffold competes with it; depth is a runtime effort setting, not a prompt keyword | Delete and use the host-supported reasoning configuration; where a step genuinely needs deliberation, say what to deliberate on |
| `thoroughness-booster` | Medium | "be thorough/comprehensive/exhaustive", "research thoroughly", "exhaustively", "leave no stone unturned", `**Remember:**` closers | Boosters add no requirement and cause dozens of unneeded searches and tool calls on frontier models | Delete; state the actual completion criterion instead |
| `anti-formatting` | Medium | "never use bullets/headers/bold", "plain text only" | Written against older models' over-formatting; current models format by audience | Delete, or state the actual audience |
| `narration-suppressor` | High | "hold findings", "don't narrate", "no interim" | Suppresses the progress updates that keep long autonomous turns legible | Delete; ask for grounded progress claims instead |
| `model-name-conditional` | Medium | "On Opus 5 the model already…", "If you are on Sonnet, run…", "For GPT-5.6 you should skip…" — a behavior branch whose condition is a model name | Effective model identity may be unavailable and tier assumptions become stale | Use observed runtime capabilities and task evidence, not self-assessed reasoning ability. Model dispatch configuration remains distinct |
| `volatile-fact` | Medium | Context sizes, model names, version pins, hard paths in behavioral text | Drifts silently on every model or release change | Link the machine-readable owner or omit |
| `migration-phrasing` | Low | "no longer", "now works", "previously", "used to" attached to a behavior rule | Describes a diff against a prompt the model never saw | Write the current rule as the only rule |
| `identity-stub` | Low | "You are a helpful/expert/elite …" with no audience or product context nearby | An identity line without context adds nothing the model lacks | Replace with audience, product, environment, quality bar |
| `budget-countdown` | High | "% used", "tokens left/remaining", "context nearly full" rendered into the prompt | Causes premature wrap-up and rushed final work | Keep it in the status line; never in the prompt |

Repeated code, paths, and parameter rows are not duplication, and neither is
the same instruction appearing in many files: each skill, agent, and output
style is loaded into its own context, so shared text is per-file instruction.
`--cross-file-duplicates` reports it anyway, at Low, when you are looking for
boilerplate worth centralising or auditing files that do share one context.

## Opt-out markers

Three markers tell the linter to stand down, and each one wants a reason
written next to it so the next reader knows the finding was judged, not
missed.

| Marker | Scope | Use it for |
|---|---|---|
| `<!-- cruft-lint-allow: reason -->` on a line of its own | the whole file | A reference whose subject matter is prompting itself, where the pattern vocabulary is the content |
| `cruft-lint-allow` trailing a content line | that line | A single keep-list line, such as a word cap on rendered UI copy or a severity scale that happens to read as emphasis |
| `<!-- fragile -->` … `<!-- /fragile -->` | the block | Exact scripts for destructive, auth, or compliance steps, where rewording changes behavior |

The file-level marker only counts on a line of its own. That is deliberate:
the same marker trailing a content line stays a line-level opt-out, so a
keep-list note cannot silently switch off the rest of the file.

Ordinary rules skip code fences. The separate `fenced-reasoning` diagnostic
inspects only unlabeled, text, plaintext, md and markdown fences for transcript
patterns; executable-language fences remain excluded. Fragile and line/file
exemptions still apply. Approval, full-read and fenced-reasoning diagnostics are review signals at Medium,
not automatic proof of an obsolete rule or a reason to weaken a contract.

Structural checks (`quick_validate.py`) sit beside these: description at
most 1024 characters including block scalars, SKILL.md and references under
300 lines, broken `references/` and `scripts/` links, and literal native tool
names that the kit capability lint rejects.

## Keep list

`optimize` must not remove these, whatever the linter says:

- Context only the author knows: audience, product, environment, quality
  bar, the reason behind a rule.
- Exact scripts for fragile operations, with their "do not modify" note.
- Tool and parameter contracts. These usually need more text, not less.
- Prohibitions whose failure still reproduces on the current model.
- Precise activation conditions and measured routing improvements.
- Examples that teach domain decisions, boundaries or format, distinguishing illustrative and exact contracts.
- Explicit user limits, runtime capability checks, permissions, budgets and ownership constraints.
- One closing recap.
- Redundancy that is working and not contradictory.

Cruft is not length. A finding must name the purpose the text no longer
serves and cite evidence; a character count is never a reason. Resolve heuristics
through a rewrite or scoped documented exemption, not by weakening CI gates.

## Audit procedure

1. **Inventory the surface.** SKILL.md, references, agents, output styles,
   and any hook text that is injected into context (hooks render prompt
   text too, and re-inject it on a timer).
2. **Establish provenance.** For each emphasized or prohibiting line, ask
   which failure it blocked, on which model, and whether the failure still
   reproduces. `git log -S"<phrase>"` and `git blame` usually answer the first
   two; a short probe on the current model answers the third.
3. **Measure real sessions.** Run `scripts/session_usage.py` for each audited
   skill and follow `references/session-usage-analysis.md` to turn its signals
   into speed, determinism, token, delegation and quality findings. With `--all`
   or a kit scope, measure the most-invoked skills first and state which were
   left unmeasured.
4. **Run the linter.** `uv run --with PyYAML==6.0.3 scripts/lint_cruft.py <path> --routing --json`
   gives rule ids, levels, and `file:line` anchors. Routing checks parse YAML;
   missing PyYAML exits 3 explicitly. Body-only mode stays standard-library-only.
5. **Review semantics and classify findings.** Check contradictory obligations,
   stale examples, overbroad activation and premature stopping against actual task
   context, relevant loaded references and the session evidence. Regex cannot
   establish these. Classify each finding against the pattern table and the keep list.
   Assign confidence: High when the text is a known pattern or a session-proven cost
   and no keep-list reason applies; Medium when it needs a rewrite rather than a
   deletion; Low when it is a flag for the author.
6. **Write the report** to `plans/reports/skill-audit-{YYMMDD-HHmm}-{slug}.md`:
   stated assumptions (scope, target model), inventory, session evidence, findings
   with `file:line`, pattern or signal, reason, and confidence, then a proposed diff
   with one hunk per High or Medium finding. Audit never edits skill files.

## Optimize procedure

1. Take the High and Medium findings from an audit report, or run the audit
   inline on the given skill, including its session evidence.
2. Rewrite rather than delete when the instruction still has a purpose:
   attach the reason, lower the volume, move it to the one place it belongs.
   For session findings, apply the matching improvement from
   `references/session-usage-analysis.md`: fix failing commands, script repeated
   procedures, tighten reference routing, parallelize independent steps, or delegate
   bounded mechanical execution to a lower-cost subagent tier while the main model
   keeps judgment and final review.
3. Merge or split references so each fact lives in exactly one file. Leave
   `description` and `when_to_use` alone unless the audit named them.
4. Verify: linter clean at High, `quick_validate.py` clean, kit validation and
   contract tests green for kit skills.
5. **Probe affected behavior.** Use `references/testing-and-iteration.md` for
   matched original/candidate artifacts and routing traces on a scratch copy.
   Select checks by changed contract and record missing coverage. Asking the model
   whether a line is needed is not evidence of improved consumer behavior.
6. Emit a diff by default, or apply it with `--apply`, and record the probe
   result and the session baseline in `plans/reports/`.

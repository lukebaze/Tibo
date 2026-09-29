# Testing and iteration

Evaluate what a consumer accomplishes. Separate structural validity, routing,
functional quality and cost. Begin with a small case set and expand from failures.

## Capture cases before optimizing

Use `assets/eval-cases.example.json` as the concrete contract. Author cases at
`evals/evals.json` in the target skill source; disposable results live beside it
or in the project's reports directory. Cases record id, split (train or holdout),
realistic prompt, expected_output, optional files and assertions with stable ids/text.
Use fabricated or approved redacted fixtures and preserve accepted user constraints.

Cover a normal task, boundary and failure/recovery when applicable. For mutations,
check input preservation, contained edits, retry behavior and honest partial status.
Keep holdout prompts outside author/rewrite context, with the split fixed across
iterations. The bundled public example demonstrates the contract; it is not an
independent holdout for evaluating this creator.

## Functional comparison

1. Snapshot before updating. Create compares no-skill with candidate; update compares
   original with candidate and reruns cases for behavior that must remain unchanged.
2. Use fresh sessions and clean workspaces with identical prompts, tools, fixtures
   and settings. Ensure the baseline cannot discover the candidate via global or
   project skills or inherited context. Consumers do not receive expected answers.
3. Record effective model id, runtime/version, snapshot hash, run/session id,
   available tools, input version and output location. Requested aliases are not
   evidence of the effective model; record what the provider reports.
4. Save artifacts and redacted execution traces. Check mechanical properties with
   code and judgment-dependent quality with an independent evidence-based rubric.
   Compare anonymized outputs when using a judge. Success claims are not artifacts.
5. Record tokens, duration, tool calls, retries and human corrections when observable.
   Unknown metrics remain null. Distinguish provider failures from skill failures;
   blocked or ungraded is not pass.
6. Repeat runs when stability matters. Report raw counts per case/model/runtime,
   compare matched case sets and settings, and state small-sample limitations.

This loop applies to normal create/update. Long-horizon adds experiment history
and promotion governance. Commands and record format: `references/evaluation-tools.md`.

## Routing comparison

Do not name or force the target skill in routing prompts. Use the real catalog
with competing skills and observe actual reads/invocations in the runtime trace.
Asking when a model would use a skill is diagnostic, not activation evidence.
Functional tests may force loading to isolate execution quality; label that separately.

Cover natural positives, indirect requests and near-miss negatives sharing terms
with adjacent skills. Use the audience's languages, informality and paraphrases.
For this creator, a reusable workflow skill is positive; building an MCP server
is an adjacent negative. Documenting a CLI does not automatically mean creating a skill.

Record query, split, expected and observed activation, run id, model, runtime,
catalog snapshot and trace evidence. Report TP/FP/FN/TN, precision = TP/(TP+FP),
recall = TP/(TP+FN); empty denominators are unknown. Keep explicit invocation separate.
Use train failures to revise scope boundaries, then check a fixed holdout without
feeding its prompts into rewriting. Adding keywords alone does not prove improvement.

## Before/after probe and iteration

For optimize, compare original and scratch candidate on tasks affected by edited
lines before applying. Classify linter findings by purpose and preserve capability,
authorization, safety and resource constraints. Do not remove a working rule merely
because it matches a regex. Record retained constraints and evidence.

Quality and invariants come first: extra tool calls may be necessary verification;
an external API outage is not automatically a skill defect. Choose a task-specific
quality/cost tradeoff, report regressions and uncertainty, and generalize patterns
rather than adding a patch for each prompt. Never loosen a baseline to force green.

Select coverage by the change. Metadata changes need actual routing comparisons;
instruction or script changes need affected consumer regression; creator workflow
changes need the creator-to-consumer loop. A semantic no-op such as spelling or
formatting can finish with structural checks and a recorded impact review. Do not
rerun an unchanged passed suite without new evidence, a failure or unresolved risk.

For cost comparisons, import observed configuration, usage and provenance through
the evaluation tools. Compare matched effort/cache conditions and inspect actual
reference reads; token totals and root line counts alone do not measure savings.
Use train failures to guide any authorized model/effort experiment and keep holdout
fixed. Do not change user runtime configuration as part of a prose optimization.

## Evaluating the creator

Use `references/creator-consumer-evaluation.md`. An author produces skills and
independent consumers execute them. Script/metadata tests alone do not measure this value.

## Large catalog diagnostics

[Semantic routing evaluation](semantic-routing-evaluation.md) is optional. Tune only
on train cases, freeze the selected metadata, then evaluate the fixed holdout once.
Do not select or rewrite another candidate from holdout outcomes while calling that
holdout untouched. Before/after metadata hashes differ by design; case identity,
canonical roster, runtime/settings, provider/model, protocol and batch schedule must
match. Full competing catalogs remain present in every batch. Diagnostic probability
changes never substitute for actual runtime activation.

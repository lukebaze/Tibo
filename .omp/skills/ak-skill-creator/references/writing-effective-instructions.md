# Writing Effective Instructions
<!-- cruft-lint-allow: this file names the patterns the linter reports -->

A skill provides practical instructions for the models and runtimes its users
actually run. State the outcome, context, constraints and verification. Treat
claims about prompting effectiveness as hypotheses until consumer tests support them.

## Writing style

Write in imperative form, verb first, in complete sentences.

- Good: "To validate the export, run `scripts/validate.py --input {file}`." <!-- resource-link-example: illustrative command -->
- Bad: "You should probably validate the data before proceeding."

Describe the audience, the product, the environment, and the quality bar.
That context is the part of a skill only the author knows; the model can
supply the rest.

## Calibrate instructions to consumers

These rules guide authoring; linter matches are review signals, not proof that
an instruction is harmful. Use `references/testing-and-iteration.md` to decide.

1. **Use clear language with reasons.** State real constraints plainly. Keep emphasis
   when it measurably helps enforce an important boundary; avoid pressure boilerplate.
2. **Match specificity to the task.** Goals and constraints suit open-ended work;
   numbered steps suit data dependencies and reliable procedures; exact commands suit
   fragile operations. State dependencies rather than prescribing incidental choreography.
3. **Respect available delegation.** Delegate when independent work benefits from fresh
   context and the runtime, authorization, ownership and resource budget permit it.
   Provide an inline fallback when delegation is optional; report a required missing
   capability instead of inventing it. Explain constraints rather than deleting them.
4. **Preserve accepted boundaries.** Keep user decisions, safety rules, output contracts
   and reproduced failure protections. Classify a prohibition by its purpose first.
5. **Keep useful context accessible.** Avoid redundant boilerplate; retain a short
   reminder when it measurably prevents errors across separately loaded resources.
6. **Write for the reader.** Lead reports with the outcome and use complete sentences.
   Concision comes from relevant content, not removing evidence or verification.
7. **Distinguish real budgets from arbitrary caps.** Preserve explicit user limits,
   machine format constraints and operating budgets; explain their purpose. Do not
   remove them just because a regex recognizes a number.
8. **Use examples to teach decisions.** Include varied normal/edge examples where they
   reduce ambiguity, show domain reasoning or pin a format. Label illustrative examples;
   distinguish exact machine contracts. Test whether consumers need more or less detail.
9. **Own volatile facts.** Resolve model/tool capabilities from the live environment.
   Put required reproducibility pins in manifests or invocation contracts and link
   their owner; avoid copying inventories into unrelated prose.
10. **Describe current behavior.** Explain what to do in a fresh session without assuming
    knowledge of the previous prompt version. Report changes in maintainer records.
11. **Define completion and reuse authorization.** Continue through the requested
    result and relevant verification inside the accepted scope. Ask for material
    missing decisions or new effects; keep explicit interactive modes and genuine
    destructive boundaries. Repair regressions caused by the change rather than
    turning every failed check into a permission loop.
12. **Route before loading.** Read the owning resource for the current task. Keep
    complete-read requirements when their dependency or format constraint needs
    them; avoid making every request load the whole catalog. Report decisions and
    evidence without requiring a transcript of internal reasoning.

A shorter prompt is not automatically better. Test target models independently;
a less capable consumer may need examples that a stronger consumer can infer.
Preserve prompt improvements only when actual outcomes support them.

## Recommended SKILL.md shape

```markdown
---
name: your-skill  # or namespace:your-skill
description: [What it does] + [when to use it] + [what it does not cover]
---
# Skill Name
Purpose in two or three sentences, including the audience and quality bar.
## Workflow router
Select the task-specific reference; state when to load it. For a single simple
workflow, inline its instructions instead of creating an unnecessary reference.
## Completion and boundaries
Outcome, constraints, authority and verification. Exact commands for fragile steps.
## Resources
Point to common-path resources; branch references own their own details.
```

Add `## Examples` when domain decisions, edge cases or output shape need clarification;
label illustrative examples and distinguish exact contracts. Add `## Troubleshooting` when a failure recurs and
has a known fix.

## Complete the authorized task

Define completion in observable terms: artifacts, required checks and honest partial
status. Reuse authorization for reversible work and fixes; ask only about material
unresolved decisions or protected boundaries. Preserve explicit review requirements,
but do not add a stop after a first draft when delivery is authorized.
Select verification from the change: new behavior needs outcome checks; formatting-only
changes need structural review. Repeat a passed check when new evidence justifies it.

## Be specific about fragile steps

Good:

```markdown
Run `python3 scripts/validate.py --input {filename}` to check the format. <!-- resource-link-example: illustrative validator -->
If validation fails, the usual causes are missing required fields or dates
that are not in YYYY-MM-DD form.
```

Bad:

```markdown
Validate the data before proceeding.
```

For a check that must be deterministic, bundle a script and call it, rather
than describing the check in prose.

## Reference bundled resources clearly

```markdown
Before writing queries, read `references/api-patterns.md` for rate limits, <!-- resource-link-example: illustrative API -->
pagination, and error codes.
```

Keep SKILL.md under 300 lines and move detailed API documentation, schemas,
extended examples, domain rules, and troubleshooting into `references/`.

## What not to include

- General knowledge the model already has.
- Tool documentation. Teach the workflow, not what the tool is.
- Text that duplicates a reference. Information lives in one place.
- Boilerplate copied from another skill or agent without a reason that
  applies here.

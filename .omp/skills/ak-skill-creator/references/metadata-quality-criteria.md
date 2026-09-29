# Metadata quality

Metadata helps the runtime select a skill. Aim for both useful activation and
correct non-activation; a longer description is not evidence of better routing.

## Name and description

Use a lowercase `skill-name` or `namespace:skill-name` such as `ak:plan`, matching
the target contract in `references/agentkit-kit-skill-contract.md`.

The description has a 1024-character maximum under the current validator contract.
Write the shortest clear description of the task and its activation boundary.
Front-load the owned action so a shortened catalog entry remains useful. Put mode
details, workflow steps and resource inventories in the body or its references.

Direct phrasing such as "Use when..." is acceptable. Include a not-for case when
it resolves a plausible overlap; do not pad the description with every adjacent topic.
Keep `when_to_use` consistent with the description and keywords tied to owned work.

## Examples

These examples illustrate scope; actual activation still needs runtime traces.

```yaml
# Broad: incidental database work does not imply a migration.
description: Create Postgres migrations. Use whenever working with databases, queries, models, or persistence.

# Specific: the action and boundary are recognizable.
description: Create and validate Postgres migrations. Use when adding or changing a migration, or reviewing its rollout.
```

```yaml
# Broad: a CSV normalization skill does not own all numeric analysis.
description: Process CSV. Use whenever data, numbers, files, or analysis are mentioned.

# Specific: states the work this skill actually performs.
description: Normalize CSV records to the project schema. Use when importing tabular records or diagnosing rejected rows.
```

Avoid generic labels such as `helper` and pressure to activate regardless of scope.
The word "whenever" alone is not a defect; judge the boundary it describes.

## Validate selection

Run `scripts/quick_validate.py` for typed metadata, naming and resource contracts.
Use `scripts/lint_cruft.py --routing` for advisory metadata signals with its declared
YAML dependency. Neither check proves activation quality or semantic consistency.

Follow `references/testing-and-iteration.md` with the real competing catalog:
natural positives, indirect requests and near-miss negatives in the audience's
languages. Measure precision and recall from reads/invocations, not a model's claim
about what it would select. Keep explicit invocation separate from automatic routing.

Malformed input stays within routing scope when validation or rejection is part
of the skill's job. A ledger validator still owns a record with an invalid
amount; its error handling should run instead of routing the request away.

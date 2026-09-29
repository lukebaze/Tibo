# Skill Validation Checklist
<!-- cruft-lint-allow: this file names the patterns the linter reports -->

Select checks for the changed behavior and delivery surface, then inspect their evidence. Run from the skill-creator directory. YAML checks use the declared PyYAML
dependency; uv resolves it into a central cache:

```bash
uv run scripts/quick_validate.py <skill-dir>          # structure, frontmatter, limits, links
uv run --with PyYAML==6.0.3 scripts/lint_cruft.py <skill-dir-or-kits-dir> --routing  # body and metadata
uv run --with PyYAML==6.0.3 scripts/package_skill.py <skill-dir>  # only for ZIP distribution
```

For a kit skill, also run `cd apps/cli && go run . kit validate ../../kits/`
(see `references/agentkit-kit-skill-contract.md`).

The existing packager validates source only. Inspect archive members and validate
an extracted copy separately; archive containment and atomic replacement are not
automated by this script. Package only an inspected source tree with no symlinks
or private configuration, using an output directory outside the skill tree.

## Must pass

Resource checks include concrete paths in fenced commands. A teaching example
that deliberately names a nonexistent file may carry `resource-link-example:`
with a reason on that line. Keep exemptions narrow; actual workflow commands
must resolve without exemptions.

### Metadata
- [ ] `name` is `skill-name` or `namespace:skill-name`, kebab-case, at most 64 characters per segment
- [ ] `description` is at most 1024 characters and states a precise activation boundary; brevity alone is not a defect
- [ ] `when_to_use` present for kit skills and consistent with the description

### Size and structure
- [ ] Size warnings reviewed for readability and ownership; useful context retained
- [ ] Valid typed YAML, no duplicate keys, no unfinished initializer placeholders
- [ ] Concrete resources resolve from SKILL.md and references, including after packaging
- [ ] No information duplicated between SKILL.md and references
- [ ] File names are kebab-case and self-describing; no leftover template files

### Prompt quality (`lint_cruft.py` reports no High findings)
- [ ] No pressure walls (clusters of MUST, NEVER, CRITICAL); each real constraint carries a reason
- [ ] No "sacrifice grammar", "ensure token efficiency", or other copied boilerplate
- [ ] Delegation guidance says when and why, not "INCOMPLETE" or "do not do X yourself"
- [ ] Explicit user limits and machine formats preserved; unexplained heuristic findings reviewed
- [ ] No volatile facts (model names, context sizes, version pins) without a link to their owner

## Scripts, if any
- [ ] Tests exist under `scripts/tests/` and pass
- [ ] Cross-platform (Python or Node.js); UTF-8 console configured on Windows
- [ ] Dependencies declared at the invocation site (pinned runner or inline metadata), see `references/script-dependency-strategy.md`
- [ ] `.env.example` shipped, never `.env`; env hierarchy respected (`process.env` > skill `.env` > shared `.env` > global `.env`)

## Quality
- [ ] Clear direct instructions; consistent description and activation conditions
- [ ] Teaches how to do the task, with the audience and quality bar stated
- [ ] Checks selected by changed behavior: routing for metadata, consumer regression for instructions/scripts, creator-consumer for creator workflow; explain semantic no-op exceptions
- [ ] Structured cases and artifact assertions cover normal, boundary and recovery behavior
- [ ] Create/no-skill or update/original comparison recorded in independent fresh contexts
- [ ] Actual routing tested with near-misses and held-out prompts; forced execution labelled
- [ ] Effective model/runtime, skill hash, artifacts, observed cost and gaps recorded
- [ ] Creator changes evaluated through independent consumers of generated skills
- [ ] Packaged contents contained, confidential material excluded, extracted artifact validated
- [ ] Delegation, when present, names the agent and the reason a fresh context is needed

## Integration
- [ ] Plausible overlaps resolved by activation boundaries; not-for cases included when useful
- [ ] Related topics consolidated rather than split into near-duplicate skills
- [ ] For kit skills: `metadata.workflow` refs resolve in every consuming kit; contract tests still pass

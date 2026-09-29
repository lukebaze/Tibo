# Token Efficiency Criteria

Skills use progressive disclosure to minimize context window usage.

## Three-Level Loading

1. **Metadata** - Always loaded (name and description)
2. **SKILL.md body** - Loaded when skill triggers (<300 lines)
3. **Bundled resources** - Loaded as needed (unlimited for scripts)

## Size Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Description | ≤1024 chars | Precise activation boundary; no minimum length |
| SKILL.md | <300 lines | Core instructions only |
| Each reference file | <300 lines | Split if larger |
| Scripts | No limit | Executed, not loaded into context |

## SKILL.md Content Strategy

**Include in SKILL.md:**
- Outcome, scope and completion criteria
- A minimal router for multiple workflows, with conditions for loading each resource
- Safety and authorization boundaries needed across workflows
- Exact common commands where their placement prevents mistakes

**Move to references/:**
- Detailed documentation
- Database schemas
- API specs
- Step-by-step guides
- Examples and templates
- Best practices

## Measure actual loading

Record the references actually read, alongside catalog and configuration fingerprints.
File size is a diagnostic, not proof of wasted context. Move unrelated mode details
out of the common path while keeping every feature reachable.

A skill cannot control provider prompt assembly, cache lifetime or effort. Cache and
effort experiments belong to a verified runner; `references/evaluation-tools.md`
owns observed evidence. Keep changing timestamps and metrics out of static guidance.

## No Duplication Rule

Information lives in ONE place:
- Either in SKILL.md
- Or in references/

**Bad:** Schema overview in SKILL.md + detailed schema in references/schema.md <!-- resource-link-example: illustrative resource name -->
**Good:** Brief mention in SKILL.md + full schema only in references/schema.md <!-- resource-link-example: illustrative resource name -->

## Splitting Large Files

If reference exceeds 300 lines, split by logical boundaries:

```
references/
├── api-endpoints-auth.md      # Auth endpoints
├── api-endpoints-users.md     # User endpoints
├── api-endpoints-payments.md  # Payment endpoints
```

Include grep patterns in SKILL.md for discoverability:

```markdown
## API Documentation
- Auth: `references/api-endpoints-auth.md` <!-- resource-link-example: illustrative API -->
- Users: `references/api-endpoints-users.md` <!-- resource-link-example: illustrative API -->
- Payments: `references/api-endpoints-payments.md` <!-- resource-link-example: illustrative API -->
```

## Scripts: Best Token Efficiency

Scripts execute without loading into context.

**When to use scripts:**
- Repetitive code patterns
- Deterministic operations
- Complex transformations

**Example:** PDF rotation via `scripts/rotate_pdf.py` vs rewriting rotation code each time. <!-- resource-link-example: illustrative resource name -->

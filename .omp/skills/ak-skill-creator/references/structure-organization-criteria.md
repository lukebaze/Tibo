# Structure & Organization Criteria

Proper structure enables discovery and maintainability.

## Required Directory Layout

```
Claude Code skills directory/
└── skill-name/
    ├── SKILL.md          # Required, uppercase
    ├── scripts/          # Optional: executable code
    ├── references/       # Optional: documentation
    └── assets/           # Optional: output resources
```

## SKILL.md Requirements

**File name:** Exactly `SKILL.md` (uppercase)

**YAML Frontmatter:** Required at top

```yaml
---
name: skill-name  # optional namespace: namespace:skill-name
description: At most 1024 chars; specific triggers and not-for cases
license: Optional
version: Optional
---
```

## Resource Directories

### scripts/
Executable code for deterministic tasks.

```
scripts/
├── main_operation.py
├── helper_utils.py
├── requirements.txt         # exception path — prefer pinned runners; see references/script-dependency-strategy.md
├── .env.example             # ship this, not .env (packager excludes .env)
└── tests/
    └── test_main_operation.py
```

### references/
Documentation loaded into context as needed.

```
references/
├── api-documentation.md
├── schema-definitions.md
└── workflow-guides.md
```

### assets/
Files used in output, not loaded into context.

```
assets/
├── templates/
├── images/
└── boilerplate/
```

## File Naming

**Format:** kebab-case, descriptive

**Good:**
- `api-endpoints-authentication.md`
- `database-schema-users.md`
- `rotate-pdf-script.py`

**Bad:**
- `docs.md` - not descriptive
- `apiEndpoints.md` - wrong case
- `1.md` - meaningless

## Cleanup

`scripts/init_skill.py` writes only SKILL.md. Delete any resource you added
during drafting and did not reference from SKILL.md.

## Scope Consolidation

Related topics should be combined into single skill:

**Consolidate:**
- `cloudflare` + `cloudflare-r2` + `cloudflare-workers` → `devops`
- `mongodb` + `postgresql` → `databases`

**Keep separate:**
- Unrelated domains
- Different tech stacks with no overlap

## Validation

Run packaging script to check structure:

```bash
scripts/package_skill.py <skill-path>
```

Checks:
- SKILL.md exists
- Valid frontmatter
- Proper directory structure

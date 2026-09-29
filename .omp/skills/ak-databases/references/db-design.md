# Database Design

Use this reference when the task is about shaping data before writing queries: schema design, table design, document modeling, analytics models, migrations, or storage trade-offs.

## Start With The Workload

Classify the primary workload before choosing a model:

| Workload | Optimize For | Common Shape |
| --- | --- | --- |
| OLTP | Correct writes, constraints, transactions | Normalized relational tables |
| OLAP | Scans, aggregations, reporting | Fact and dimension tables |
| Document workflow | Locality, flexible nested data | MongoDB collections with embedded documents |
| Event history | Append-only audit and replay | Events plus projected read models |

Ask for expected write rate, read paths, retention, reporting needs, and consistency requirements. Do not pick MongoDB or PostgreSQL only from preference; pick from access patterns and integrity needs.

## Relational Schema Checklist

- Name entities as nouns and join tables by the relationship they represent.
- Put stable identity in primary keys and business uniqueness in unique constraints.
- Use foreign keys when orphaned data would be a bug.
- Keep money, quantities, and timestamps in precise types; avoid floats for money.
- Model many-to-many relationships explicitly with a join table and useful metadata columns.
- Add indexes for proven query predicates, joins, ordering, and uniqueness.
- Document migration and rollback steps for destructive changes.

## Document Model Checklist

- Embed data that is read and written with the parent and has bounded size.
- Reference data that grows without bound, is shared by many parents, or needs independent lifecycle rules.
- Keep frequently queried fields at predictable paths and index them.
- Avoid large arrays that are updated concurrently or unbounded over time.
- Treat schema validation as part of the application contract, even when the database is flexible.

## Analytics Model Checklist

- Define grain first: one row per what event or measurement.
- Separate facts from dimensions.
- Preserve source identifiers and ingestion timestamps for traceability.
- Precompute only when query cost or latency justifies it.
- Version derived metrics so reports can explain historical changes.

## Review Questions

1. What are the top five reads and writes this design must support?
2. Which invariants must the database enforce, not just the application?
3. What data can grow without bound?
4. What must be restorable from backups or audit logs?
5. Which fields are sensitive, regulated, or subject to deletion requests?

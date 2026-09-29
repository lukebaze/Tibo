# Memory Systems

Architectures for persistent context beyond the window.

## Memory Layer Architecture

| Layer | Scope | Persistence | Use Case |
|-------|-------|-------------|----------|
| L1: Working | Current window | None | Active reasoning |
| L2: Short-Term | Session | Session | Task continuity |
| L3: Long-Term | Cross-session | Persistent | User preferences |
| L4: Entity | Per-entity | Persistent | Consistency |
| L5: Temporal Graph | Time-aware | Persistent | Evolving facts |

## Evidence and freshness

Choose memory architecture on representative retrieval and continuation tasks. Do not
compare unsourced accuracy figures across different datasets. Track provenance, source
revision, permissions and invalidation conditions; refresh consequential stale facts.
Persist only in authorized locations. Unknown or inferred statements stay distinguishable
from observed facts, and memory content does not become higher-priority instructions.

## Vector Store with Metadata

```python
class MetadataVectorStore:
    def add(self, text, embedding, metadata):
        doc = {
            "text": text, "embedding": embedding,
            "entities": metadata.get("entities", []),
            "timestamp": metadata.get("timestamp")
        }
        self.index_by_entity(doc)

    def search_by_entity(self, entity, k=5):
        return self.entity_index.get(entity, [])[:k]
```

## Temporal Knowledge Graph

```python
class TemporalKnowledgeGraph:
    def add_fact(self, subject, predicate, obj, valid_from, valid_to=None):
        self.facts.append({
            "triple": (subject, predicate, obj),
            "valid_from": valid_from,
            "valid_to": valid_to
        })

    def query_at_time(self, subject, predicate, timestamp):
        for fact in self.facts:
            if (fact["triple"][0] == subject and
                fact["valid_from"] <= timestamp and
                (fact["valid_to"] is None or timestamp <= fact["valid_to"])):
                return fact["triple"][2]
```

## Memory Retrieval Patterns

| Pattern | Query | Use Case |
|---------|-------|----------|
| Semantic | "Similar to X" | General recall |
| Entity-based | "About user John" | Consistency |
| Temporal | "Valid on date" | Evolving facts |
| Hybrid | Combine above | Production |

## File-System-as-Memory

```
memory/
├── sessions/{id}/summary.md
├── entities/{id}.json
└── facts/{timestamp}_{id}.json
```

## Guidelines

1. Start with file-system-as-memory (simplest)
2. Add vector search for scale
3. Use entity indexing for consistency
4. Add temporal awareness for evolving facts
5. Implement consolidation for health
6. Measure retrieval accuracy

## Related

- [Context Fundamentals](./context-fundamentals.md)
- [Multi-Agent Patterns](./multi-agent-patterns.md)

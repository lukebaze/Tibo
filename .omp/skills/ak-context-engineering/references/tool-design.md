# Tool Design

Design effective tools for agent systems.

## Tool selection

Expose distinguishable tools with clear inputs, outputs, errors and ownership.
Consolidate overlapping operations only when routing becomes simpler without weakening
safety or capability. Use discovery for large catalogs; no fixed tool count is universal.
Evaluate success, duration, cost and steps on the same tasks before changing the interface.

## Description Engineering

Answer four questions:
1. **What** does the tool do?
2. **When** should it be used?
3. **What inputs** does it accept?
4. **What** does it return?

### Good Example

```json
{
  "name": "get_customer",
  "description": "Retrieve customer profile by ID. Use for order processing, support. Returns 404 if not found.",
  "parameters": {
    "customer_id": {"type": "string", "pattern": "^CUST-[0-9]{6}$"},
    "format": {"enum": ["concise", "detailed"]}
  }
}
```

### Poor Example

```json
{"name": "search", "description": "Search for things", "parameters": {"q": {}}}
```

## Error Messages

```python
def format_error(code, message, resolution):
    return {
        "error": {"code": code, "message": message,
                  "resolution": resolution, "retryable": code in RETRYABLE}
    }
# "Use YYYY-MM-DD format, e.g., '2024-01-05'"
```

## Response Formats

Offer concise vs detailed:

```python
def get_data(id, format="concise"):
    if format == "concise":
        return {"name": data.name}
    return data.full()  # Detailed
```

## Guidelines

1. Remove ambiguity and unnecessary overlap; measure the resulting workflow
2. Answer all four questions
3. Use full parameter names
4. Design errors for recovery
5. Offer concise/detailed formats
6. Test with agents before deploy
7. Start minimal, add when proven

## Related

- [Context Fundamentals](./context-fundamentals.md)
- [Multi-Agent Patterns](./multi-agent-patterns.md)

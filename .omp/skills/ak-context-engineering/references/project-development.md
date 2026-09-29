# Project Development

Design and build LLM-powered projects from ideation to deployment.

## Task-Model Fit

**LLM-Suited**: Synthesis, subjective judgment, NL output, error-tolerant batches
**LLM-Unsuited**: Precise computation, real-time, perfect accuracy, deterministic output

## Manual Prototype First

Test one example with target model before automation.

## Pipeline Architecture

```
acquire → prepare → process → parse → render
 (fetch)  (prompt)   (LLM)   (extract) (output)
```

Stages 1,2,4,5: Deterministic, cheap | Stage 3: Non-deterministic, expensive

## File System as State

```
data/{id}/
├── raw.json      # acquire done
├── prompt.md     # prepare done
├── response.md   # process done
└── parsed.json   # parse done
```

```python
def get_stage(id):
    if exists(f"{id}/parsed.json"): return "render"
    if exists(f"{id}/response.md"): return "parse"
    # ... check backwards
```

**Benefits**: Idempotent, resumable, debuggable

## Structured Output

```markdown
## SUMMARY
[Overview]

## KEY_FINDINGS
- Finding 1

## SCORE
[1-5]
```

```python
def parse(response):
    return {
        "summary": extract_section(response, "SUMMARY"),
        "findings": extract_list(response, "KEY_FINDINGS"),
        "score": extract_int(response, "SCORE")
    }
```

## Cost estimation

Track all calls, input/cache/output pricing, failed attempts, tools and integration.
Use dated observed runs or explicit estimates with coverage. A flat price multiplied
by output tokens omits most replay and tool costs. See [model selection](model-selection.md)
and [evaluation](evaluation.md) for the four metrics and their denominator contracts.

## Single vs Multi-Agent

| Factor | Single | Multi |
|--------|--------|-------|
| Context | Fits window | Exceeds |
| Tasks | Sequential | Parallel |
| Cost | One trajectory | Include all workers and integration |

## Guidelines

1. Validate manually before automating
2. Use 5-stage pipeline
3. Track state via files
4. Design structured output
5. Estimate costs first
6. Start single, add multi when needed

## Related

- [Context Optimization](./context-optimization.md)
- [Multi-Agent Patterns](./multi-agent-patterns.md)

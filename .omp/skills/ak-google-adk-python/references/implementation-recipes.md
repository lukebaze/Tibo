## Quick Start

```bash
pip install google-adk          # stable (weekly releases)
uv sync --all-extras            # dev setup (uv required, Python 3.10+, 3.11+ recommended)
```

```python
from google.adk import Agent

root_agent = Agent(
    name="assistant",
    model="gemini-2.5-flash",
    instruction="You are a helpful assistant.",
    description="General assistant agent.",
    tools=[get_weather],
)
```

## App Pattern (Production)

```python
from google.adk import Agent
from google.adk.apps import App
from google.adk.apps.app import EventsCompactionConfig
from google.adk.plugins.save_files_as_artifacts_plugin import SaveFilesAsArtifactsPlugin

app = App(
    name="my_app",
    root_agent=Agent(name="my_agent", model="gemini-2.5-flash", ...),
    plugins=[SaveFilesAsArtifactsPlugin()],
    events_compaction_config=EventsCompactionConfig(compaction_interval=2),
)
```

Use `App` when needing plugins, event compaction, or custom lifecycle management.

## CLI Tools

| Command | Purpose |
|---------|---------|
| `adk web <agents_dir>` | Dev UI (recommended for development) |
| `adk run <agent_dir>` | Interactive CLI testing |
| `adk api_server <agents_dir>` | FastAPI production server |
| `adk eval <agent> <evalset.json>` | Run evaluation suite |

## Agent Types

| Type | Use Case |
|------|----------|
| `Agent` / `LlmAgent` | Dynamic routing, tool use, reasoning |
| `SequentialAgent` | Fixed-order pipeline |
| `ParallelAgent` | Concurrent execution |
| `LoopAgent` | Iterative processing |
| `RemoteA2aAgent` | Remote agent via A2A protocol |

## Key APIs

| Feature | API |
|---------|-----|
| State | `tool_context.state[key] = value` |
| Artifacts | `tool_context.save_artifact(name, part)` |
| Callbacks | `before_agent_callback`, `after_model_callback`, etc. |
| MCP Tools | `MCPToolset(connection_params=StdioConnectionParams(...))` |
| Sub-agents | `Agent(..., sub_agents=[agent1, agent2])` |
| Human-in-loop | `LongRunningFunctionTool(func=my_func)` |
| Plugins | `App(..., plugins=[MyPlugin()])` |

## Model Support

Flash: `gemini-2.5-flash` (default, stable), `gemini-3-flash-preview` (preview)
Pro: `gemini-2.5-pro` (stable), `gemini-3.1-pro-preview` (preview)
Also: Anthropic Claude, Ollama, LiteLLM, vLLM, Model Garden

## Best Practices

1. **Code-first** — define agents in Python for version control and testing
2. **Agent convention** — always use `root_agent` or `app` variable in `agent.py`
3. **Modular agents** — specialize per domain, compose via `sub_agents`
4. **Workflow selection** — workflow agents for predictable, LlmAgent for dynamic
5. **State** — `ToolContext.state` for ephemeral, `MemoryService` for long-term
6. **Safety** — callbacks for guardrails, tool confirmation for sensitive ops
7. **Evaluate** — test with `adk eval` + evalset JSON before deployment

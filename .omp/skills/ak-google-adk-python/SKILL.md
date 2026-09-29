---
name: ak-google-adk-python
description: "Build AI agents with Google ADK Python. Multi-agent systems, A2A protocol, MCP tools, workflow agents, state/memory, callbacks/plugins, Vertex AI deployment, evaluation."
user-invocable: true
when_to_use: "Invoke for Google ADK agents, A2A, MCP, or Vertex deployment."
category: engineering
keywords: [google-adk, agents, a2a, mcp, vertex-ai]
license: Apache-2.0
argument-hint: "[agent or feature]"
metadata:
  author: agentkit
  version: "2.0.1"
---

# Google ADK Python Skill

Expert guide for Google's Agent Development Kit (ADK) Python — open-source, code-first toolkit for building, evaluating, and deploying AI agents. Optimized for Gemini, model-agnostic by design.

## When to Activate

- Build single or multi-agent systems with tool integration
- Implement A2A protocol for remote agent communication
- Integrate MCP servers as agent tools
- Use workflow agents (sequential, parallel, loop) for pipelines
- Manage sessions, state, memory, and artifacts
- Add callbacks, plugins, or observability hooks
- Deploy to Cloud Run, Vertex AI Agent Engine, or GKE
- Evaluate agents with `adk eval` framework

## Agent Structure Convention (Required)

```
my_agent/
├── __init__.py   # MUST: from . import agent
└── agent.py      # MUST: root_agent = Agent(...) OR app = App(...)
```

## Route by intent

Inspect the installed ADK dependency and project conventions. Keep `root_agent`/`app`
entrypoint discovery above. Single-agent work uses `references/agent-types-and-architecture.md`;
workflow/A2A uses `references/multi-agent-and-a2a-protocol.md`; tools use
`references/tools-and-mcp-integration.md`; deployment uses its target reference below.
Optional API examples live in `references/implementation-recipes.md`; verify them against
the installed SDK and live model catalog rather than upgrading to fit a sample.

For inference, define an observable task/eval and record model, failures, duration and cost
when telemetry exists (otherwise unknown). Check tool effects, session boundaries and
failure paths. Start minimal, expand only to fulfill the requested workflow.

## References

Detailed guides (load as needed):

- `references/agent-types-and-architecture.md` — Agent types, workflows, custom agents
- `references/tools-and-mcp-integration.md` — Custom tools, MCP, tool filtering
- `references/multi-agent-and-a2a-protocol.md` — Sub-agents, A2A, coordinator patterns
- `references/sessions-state-memory-artifacts.md` — State, artifacts, sessions, memory
- `references/callbacks-plugins-observability.md` — Lifecycle hooks, plugins, tracing
- `references/evaluation-testing-cli.md` — adk eval, CLI, evalset format
- `references/deployment-cloud-run-vertex-gke.md` — Cloud Run, Vertex AI, GKE

## External Resources

- GitHub: https://github.com/google/adk-python
- Docs: https://google.github.io/adk-docs/
- Samples: https://github.com/google/adk-python/tree/main/contributing/samples
- llms.txt: https://raw.githubusercontent.com/google/adk-python/refs/heads/main/llms.txt

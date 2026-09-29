# AgentKit Domain Routing

Use this file only when choosing between installed AgentKit skills. If the user
asks to discover or install external skills, return to `../SKILL.md` and use the
Skills CLI flow.

## Routing Rules

- If the user names a skill, use that skill.
- Pick one primary skill per distinct intent. Mention secondary skills only as
  follow-up helpers.
- If the task needs a multi-step sequence, read
  `../../cook/references/workflow-routing.md` after choosing the primary skill.
- If two skills overlap, prefer the more specific domain skill over a generic
  workflow skill.

## Frontend and UI

| User intent | Primary skill |
|---|---|
| Replicate a mockup, screenshot, or video | `/ak:frontend-design` |
| Build React or TypeScript components | `/ak:frontend-development` |
| Style with Tailwind or shadcn/ui | `/ak:ui-styling` |
| Choose color, typography, layout, or design system | `/ak:ui-ux-pro-max` |
| Audit UI accessibility or UX | `/ak:ui-ux-pro-max` |
| Apply React or Next.js performance patterns | `/ak:react-best-practices` |
| Generate UI designs with Stitch | `/ak:stitch` |
| Build 3D, WebGL, or Three.js scenes | `/ak:threejs` |
| Write shaders or procedural graphics | `/ak:shader` |
| Create an editable Excalidraw canvas or codebase map | `/ak:excalidraw` |

## Codebase Understanding

| User intent | Primary skill |
|---|---|
| Locate files or understand code quickly | `/ak:scout` |
| Pack a repository for LLM use | `/ak:repomix` |
| Semantic go-to-definition or find-usages | `/ak:gkg` |
| Build a queryable knowledge graph | `/ak:graphify` |

## Backend, Data, and Auth

| User intent | Primary skill |
|---|---|
| Build REST, GraphQL, or backend services | `/ak:backend-development` |
| Add auth, OAuth, sessions, or passkeys | `/ak:better-auth` |
| Design schemas or write SQL/NoSQL queries | `/ak:databases` |
| Integrate Stripe, Polar, Paddle, or SePay | `/ak:payment-integration` |

## Infrastructure and Security

| User intent | Primary skill |
|---|---|
| Deploy to hosted platforms | `/ak:deploy` |
| Docker, Kubernetes, CI/CD, or cloud ops | `/ak:devops` |
| STRIDE/OWASP audit with remediation | `/ak:security` |
| Secret, dependency, or vulnerability scan | `/ak:security` (`--secrets-only`, `--deps-only`) |
| OSINT or cyber threat intelligence | `/ak:cti-expert` |

## AI, MCP, and Browser Automation

| User intent | Primary skill |
|---|---|
| Context, memory, or agent architecture | `/ak:context-engineering` |
| Generate `llms.txt` | `/ak:llms` |
| Build Google ADK agents | `/ak:google-adk-python` |
| Build MCP servers | `/ak:mcp-builder` |
| Expose website features as in-browser agent tools (WebMCP) | `/ak:webmcp` |
| Convert code into CLI/MCP surface | `/ak:agentize` |
| Test generic browser workflows | `/ak:agent-browser` |
| Use the user's real Chrome profile | `/ak:chrome-profile` |

## Testing, Docs, and Media

| User intent | Primary skill |
|---|---|
| Run tests, coverage, or TDD gates | `/ak:test` |
| Playwright, Vitest, k6, visual or a11y tests | `/ak:web-testing` |
| Project docs init/update/summarize | `/ak:docs` |
| Library/framework docs lookup | `/ak:docs-seeker` |
| Visual explanation, preview, slides, or diagrams | `/ak:preview` |
| Editorial-grade PNG/SVG or animated MP4/GIF diagrams (24 templated types + animation catalog) | `/ak:diagram` |
| Mermaid syntax | `/ak:mermaidjs-v11` |
| Publish-grade technical diagrams (non-templated) | `/ak:tech-graph` |
| Video/audio/image processing | `/ak:media-processing` |
| HTML-template video rendering | `/ak:hyperframes` |

## Planning, Research, and Agent Workflow

| User intent | Primary skill |
|---|---|
| Pressure-test a plan, design, or idea through an interview | `/ak:advise` |
| Draft a self-contained brief for a researcher | `/ak:research-prompt` |
| Preserve conversation state for a fresh agent | `/ak:handoff` |
| Hand the captured state to a selected coding runtime via orchestrate | `/ak:handoff --dispatch --agent <id>` |
| Extract user decisions into a README, ADR, or structured document | `/ak:interview-docs` |
| Create local context files for a subfolder | `/ak:folder-context` |
| Prepare / preflight a long-running goal with an outcome lock | `/ak:goal-warmup` |
| Run a durable Codex objective with a verifiable stop condition | `/ak:codex-goal` |
| Benchmark a coding model on DeepSWE through OpenRouter | `/ak:deep-swe` |

## Frameworks and Platforms

| User intent | Primary skill |
|---|---|
| Next.js, App Router, RSC, Turborepo | `/ak:web-frameworks` |
| TanStack Start/Form/AI | `/ak:tanstack` |
| React Native, Flutter, SwiftUI, Kotlin | `/ak:mobile-development` |
| Shopify apps, extensions, or themes | `/ak:shopify` |

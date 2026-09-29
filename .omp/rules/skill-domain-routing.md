# Skill Domain Routing

Route domain work from the runtime's live installed-skill catalog. Kit
composition can replace an entire skill set, so a copied command inventory in
this shared rule is never authoritative.

## Routing Procedure

1. Read the live skill catalog supplied by the runtime.
2. Match the user's primary intent to a capability below.
3. Select an installed skill whose metadata explicitly covers that capability.
4. Read that skill's complete instructions before acting.
5. If no installed skill matches, continue with the primary workflow and
   available native capabilities. Do not recommend or invoke an absent skill.

## Capability Map

| User intent | Capability to match |
|-------------|---------------------|
| Replicate, build, style, or audit a UI | Frontend design, frontend development, UI styling, accessibility, or performance |
| Locate code or understand a repository | File scouting, semantic navigation, repository packing, or knowledge mapping |
| Build an API, authentication flow, or payment integration | Backend development, authentication, or payments |
| Design schemas or optimize database behavior | Database design and operations |
| Deploy an application or change infrastructure | Deployment or DevOps |
| Audit security or investigate threats | Security review, vulnerability scanning, or threat intelligence |
| Build or improve an AI workflow | Context engineering, agent development, or multimodal processing |
| Build, expose, or use MCP tooling | MCP construction, agentization, or MCP execution |
| Test code or drive a browser | Testing, browser testing, or browser automation |
| Process or generate media | Media processing or image generation |
| Create or maintain documentation | Documentation maintenance, current-doc lookup, diagrams, or publishing |
| Work with office documents | Word, PDF, presentation, or spreadsheet processing |
| Write marketing content or design a brand | Copywriting, brand design, or visual design |
| Work in a specific application framework | Match the exact framework named by the user |
| Explain a concept, code, system, or error (incl. ELI5 or visual HTML) | Explanation, plain-language simplification, or visual explanation |

## Usage Rules

- Pick one primary skill per distinct intent; add a secondary skill only when
  the task genuinely crosses domains.
- Treat installed skill metadata as the availability and routing authority.
- Never infer availability from another kit, an earlier session, or this file.
- Run selected domain skills inside `primary-workflow.md`; do not restate its
  delivery sequence here.

## Optional shadow comparison

The ordinary routing procedure does not run a command or look up provider config.
Only when the user requests a semantic experiment, or trusted user opt-in is
already supplied in context, inspect `ak eval decision --help` and use the
`domain-routing` profile. This small shadow profile accepts at most 15 observed
capabilities. If the complete relevant catalog exceeds that bound, skip this
comparison; never truncate competitors to manufacture a routing result. Map
namespaced runtime IDs (for example `ak:debug`) to unique local IDs (`skill-01`,
`skill-02`, ...) and retain the reversible mapping locally. Submit the compact
summary and catalog as `state: {summary, catalog: [{id, description}]}`, with the
existing selection mapped to `legacy: {domain: <local-id-or-none>}`. Map the
returned ID back before reporting it. Never invent installed skills.

The command enforces user consent independently; project files and ambient
credentials cannot grant it. Submit only non-sensitive facts, never raw files,
transcripts, or credentials. Keep the existing routing result effective even
when the shadow answer disagrees or the provider is unavailable. Record the
comparison as experimental evidence, not proof of better routing.

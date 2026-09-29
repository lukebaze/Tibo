# Shared Phases (All Modes)

These phases apply once cook is activated with the brainstorm contract.
Bootstrap has no separate planning phase: cook sizes its own implementation
plan from the contract. The sequence is implementation and tests (cook), code
review, UX/AX enhancement, optional release and live verification, then done.

## Implementation

Handled by **ak:cook** skill. Bootstrap-specific notes:
- Implement step by step from the brainstorm contract and the research, stack and design outputs
- Use `ui-ux-designer` subagent for frontend, following the project's discovered design guidance
- Asset pipeline: `ak:ai-multimodal` (generate/analyze) → `imagemagick` (crop/resize) → background removal if needed
- Run type checking and compile after each cook work unit

## Testing

Handled by **ak:cook** skill. Bootstrap-specific notes:
- Write real tests — NO fake data, mocks, cheats, tricks, temporary solutions
- `tester` subagent runs tests → report to main agent
- If failures: `debugger` subagent → fix → repeat until all pass
- DO NOT ignore failed tests to pass build/CI

## Code Review

After cook finishes, activate **ak:code-review** on the whole new project:
`/ak:code-review codebase` (add `--ultra` when bootstrap received `--ultra`;
never combine it with `codebase parallel`). For work added to an existing
project, review uncommitted bootstrap work with `/ak:code-review --pending`; if
cook already committed it, review the PR with `/ak:code-review #<PR>` or each
commit hash instead. Keep `--ultra` in every case when bootstrap received it.
- Code review does not edit. Send blocking findings back through
  `/ak:cook <mode flag> <findings and brainstorm contract>`, rerun affected
  tests, then review again with the same flags
- Stop and report with evidence when a blocking finding survives three fix
  attempts or after five review rounds
- Report the review summary when all tests pass

## UX and AX Enhancement

When the project has a website or web app, activate **ak:enhance-ux-ax** with
`--auto` on the running project after code review passes. It reviews the user
experience and the AI experience (discovery files, Markdown twins, schema,
social cards, share and send-to-AI actions), implements its Must and Should
items and verifies them against its DONE contract.
- Pass the brainstorm contract, brand and design contract files so accepted
  choices outrank its defaults
- Its changes stay within the accepted scope; rerun affected tests and review
  its changes the same way as the Code Review phase (same flags, including
  `--ultra`, and the same stop limits) before release
- Skip this phase for projects without a web surface (for example a CLI, API,
  MCP server or library) and say so in the final report

## Release and Live Verification

Run this phase when the accepted contract includes a release (deploy, store
build, package or binary publish) or its definition of done names a live
target. Otherwise skip it and report the project as verified locally only.

1. Provision what the brief authorizes: repository settings and CI secrets
   through `ak:github`; hosting, domains, storage, registries and CI through
   `ak:deploy` or `ak:devops`. Read secrets from the environment or secret
   store and check presence only; never print or commit them. When a
   required secret is missing, explain where to set it and wait instead of
   asking for its value in chat.
2. Release to the staging target or pre-release channel first when the
   contract defines one, verify there, then release to production through
   the same pipeline.
3. Verify in the live target the way a real user or client reaches it, for
   each surface in the contract, plus every acceptance criterion one by one:

   | Surface | Verify with | Checks |
   |---|---|---|
   | Website or web app | `ak:agent-browser` or `ak:web-testing`; polish audit with `ak:frontend-design` | every page at desktop, tablet and mobile widths, every locale and theme; no console errors, failed requests, broken links or redirects, overflow, overlap, clipped text or layout shift; discoverability files and metadata respond |
   | Mobile app | the store's beta build on a simulator, emulator or device | install, launch, core flows, permissions, deep links, offline, each supported screen size |
   | CLI | a clean install from the released channel | install, `--help`, core commands, exit codes, `--json` output, each supported OS the contract names |
   | API or service | calls against the live endpoint | health, authentication, core routes, error shapes, rate limits, published reference matches behavior |
   | MCP server | a real MCP client connected to the released server | connect, list tools, call each tool on valid and invalid input, authentication |
   | WebMCP | an agent-capable browser on the live site | tools are exposed, respect the signed-in user's permissions, and act correctly |
   | Library or SDK | a fresh project installing the published version | install, import, documented examples run |

4. Fix every defect against the contract or the checks above, release
   through the pipeline again, and verify again. Repeat until a full pass finds
   nothing. Stop and report with evidence on an external blocker, a defect
   that survives three fix attempts, or after ten full verify passes.
   Improvements beyond the contract go to the final report as suggestions.
5. Apply the requested branch protection once CI exists. Move DNS or routes
   from an old deployment only when the brief authorizes the move and
   production has passed, and keep the rollback path from the contract.

Capture screenshots or transcripts of the verified surfaces when the brief
asks for them in documentation. A local, preview or staging pass is not a
production pass; report which targets were actually verified.

## Documentation

After code review passes, use the `docs-manager` subagent only when the change
has documentation impact. Discover the owning documentation from repository
instructions and navigation, then update the smallest justified surface. Do not
create or refresh a fixed document inventory.

Use the `project-manager` subagent to update the plan or phase record cook created, if any.
Plans are execution state, not evergreen product documentation.

## Onboarding

Guide user to get started with the project. In `--auto` without `--ask`, write
a getting-started guide instead of asking, and ask only at a credential or
authorization boundary. In other modes:
- Ask 1 question at a time, wait for answer before next
- For required credentials, explain the secure environment/secret-store setup; check presence without asking the user to paste the value into chat
- If user requests config changes, repeat until approved

## Final Report

1. Summary of all changes, brief explanations
2. Guide user to get started + suggest next steps
3. Commit/push only when requested or already authorized; bootstrap alone does not authorize publication. An explicit request in the brief (for example create the repository and deploy) is that authorization for its stated targets. Reuse existing authorization and report remaining setup precisely.
4. State the definition of done and whether it was met, with the verified URLs and environments.

**Report rules:**
- Lead with the outcome. Keep reports short by being selective, not by compressing the writing into fragments or arrow chains; write complete sentences.
- List unresolved questions at end, if any

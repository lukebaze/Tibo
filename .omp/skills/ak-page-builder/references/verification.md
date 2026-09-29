# Verify the integrated builder

Read this when defining acceptance or finishing a builder integration/update.
Use the project's test tools and isolated test data. Run affected checks first;
expand for shared contracts. Keep evidence tied to the actual source/artifact.

## Capability acceptance

| Area | Evidence |
|---|---|
| Discovery/adapters | Actual stack and owners found; representative existing components render |
| Registry/model | Props/slots/bindings validated; stable IDs survive round-trip and migration |
| Widget sizing | Meaningful small/medium/large presentations; container-fit rules, lossless resize and interface parity |
| Operations | Atomic batches, scoped auth, idempotent retry and revision conflict recovery |
| Human editor | Phone/tablet/desktop edits; touch/keyboard alternatives, autosave and reconnect |
| Draft/preview | Correct immutable revision, private access, expiry/revocation and no export leakage |
| Publication | Exact revision/build becomes live; failure preserves live state; rollback works |
| Interfaces | Real API/CLI/stdio/HTTP/WebMCP calls, or specifically identified unsupported runtime |
| Docs/exports | Tested examples, OpenAPI viewer, HTML/Markdown parity and public-only indexes |
| Performance | Representative baseline/budgets, responsive interactions and public bundle separation |
| Deployment | Cloudflare configuration and live smoke when authorized/available |
| Operator skill | Installed creator activated; project skill created/updated and consumer-tested |
| Rerun safety | Second setup/update preserves custom files and does not duplicate storage/config |

Run the central journey: an agent discovers existing blocks, creates a page,
changes props and a binding, resizes a widget, reorders content and creates a preview; a human
changes it in the editor; the agent reads those changes, publishes the specified
revision, verifies the live representation and restores a compatible revision.

Add failure cases for missing block versions, provider dependencies, invalid
nesting, oversized inputs, multi-tenant access, stale drafts, interrupted saves,
live data changes, broken builds, concurrent publishers, missing assets and
partial cache/export updates. Include localization, long content and narrow
screen/touch interaction. Fix regressions rather than weakening the assertions.

## Skill effectiveness

For this builder skill and the generated operator skill, compare fresh consumers
against no skill or the previous version with matched tasks, tools and fixtures.
Use the creator's evaluation contract. Collect real artifacts and execution
traces, model/runtime, skill/contract snapshot, task success and observed costs.
Use English and Vietnamese positive routing prompts plus adjacent negatives.

The cases in `../evals/evals.json` describe authoring/evaluation scenarios. They
are not proof that any framework, browser or cloud service already passed.
Supply an appropriate disposable host fixture before executing integration cases.
Do not claim a clean holdout for cases the author has already read.

Distinguish structural validation, contract/design probes, actual activation,
functional integration and live deployment. Mark unavailable runners, credentials,
devices or platforms as untested/blocked with exact remaining work. A design
response or a validator pass alone is not an end-to-end success.

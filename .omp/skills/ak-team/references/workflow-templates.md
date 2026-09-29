# Team workflow templates

Load only the selected template; the root lifecycle and ownership contract apply.

## Research Template

Use for independent research angles.

1. Derive distinct angles such as proven approaches, alternatives, and risks.
2. Register one owned work item and report destination per angle.
3. Spawn one researcher per angle.
4. Wait for completion messages and verified shared state; redirect stalled or
   overlapping work through direct messages.
5. Read all reports and synthesize one comparison with recommendations and
   unresolved questions.

## Cook Template

Use for parallel implementation from an accepted plan or bounded description.

1. Read or create the plan, then split it into independent groups with
   non-overlapping file ownership.
2. Register developer work plus verification work that depends on all relevant
   implementation groups.
3. Spawn developers with isolated worktrees when supported and required.
4. If plan approval is enabled, keep each developer read-only until the lead
   approves its scoped plan through the live approval surface.
5. Wait for verified developer completion before assigning integrated testing.
6. Integrate branches through an assigned merge teammate in delegate mode, or
   through the repository's normal merge workflow otherwise.
7. Run the combined test and review gates.
8. Record the required docs-impact decision:

   ```text
   Docs impact: [none|minor|major]
   Action: [no update needed -- reason] | [updated page] | [needs separate PR]
   ```

## Review Template

Use for independent evidence-based review focuses.

1. Derive distinct focuses such as security, performance, test coverage,
   architecture, or accessibility.
2. Register one read-only scope and report destination per reviewer.
3. Require severity, evidence, impact, and recommendation for every finding.
4. Wait for all required scopes, contact stale owners, and do not treat idle as
   completion.
5. Deduplicate findings, reconcile disagreements, and synthesize an ordered
   action list.

## Debug Template

Use for competing, independently testable root-cause hypotheses.

1. Derive hypotheses that predict different observable evidence.
2. Register one hypothesis per debugger with explicit evidence-for and
   evidence-against requirements.
3. Encourage direct challenges between debuggers through the live message
   surface.
4. Wait for all relevant evidence, then identify the surviving theory.
5. Write a durable root-cause report with the evidence chain, disproven
   hypotheses, and recommended fix.

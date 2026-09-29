# Advisory supervision

Load only when `--advice` is active. `kongming` advises; the main agent retains
responsibility for decisions, edits and gates. Resolve delegation from the actual
runtime. If required counsel is unavailable, report that coverage explicitly.

Request counsel at the checkpoints relevant to the selected workflow:

- After intent capture and planning for create, or the inventory for audit/optimize:
  pass the intent or findings and ask for readiness and the top risk.
- After the draft and consumer evaluations: pass the draft and matched comparison;
  ask what to keep, cut or restructure.
- Before packaging, applying an optimize diff or registering a kit skill: pass
  validation, scope and remaining concerns before shipping.
- When stuck: pass conflicting evidence, attempted approaches and the exact obstacle.

Use `delegate_agent capability(subagent_type="kongming", prompt="<task, evidence, approaches tried, exact question>", description="advice: <checkpoint>")`.
Provide enough context for one reply; counsel does not introduce a user interview.
Do not request packaging or draft checkpoints for a report-only audit.
Advice never bypasses validation, packaging checks, authorization or security policy.

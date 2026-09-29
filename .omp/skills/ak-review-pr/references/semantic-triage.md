# Optional semantic finding triage

Run only when the user explicitly opts into a finding-triage experiment after
candidate discovery. Do not add a startup check or provider lookup to ordinary
review. Inspect installed `ak eval triage --help`; default mode is off.

Keep original IDs, evidence, severity and deep-review/release decisions in the
local record. Prepare compact sanitized facts and use the owning severity
vocabulary. Remove all discovered secret values from the entire batch, including
peer summaries; secret findings use only a fixed category description. Never
submit raw scanner dumps, full source, credentials or sensitive paths.

Shadow mode requires user provider consent, explicit review-triage consumer
consent and credential. Compare six typed signals with original decisions.
Protected Critical/High signals, unknowns and provider failures retain deep
review. Duplicate/auto-fix signals never authorize suppression or edits. Existing
review, threat-model, verification and approval requirements remain effective.

Use frozen shadow receipts plus independently verified labels with
`ak eval triage-benchmark` to measure important recall, false suppression,
coverage and hypothetical review reduction before considering any future control
mode. Synthetic fixtures are not evidence of real provider benefit.

# WebMCP Best Practices

Applies to both the imperative and declarative APIs. The goal: tools an agent
can pick and call correctly on the first try, without reading outputs and
retrying.

## 1. Create a tool strategy first

- **One function per tool.** One tool routes to a form; a different tool fills
  fields. Ask "can one function cover several tasks?" Avoid overlapping tools —
  overlap makes the agent unsure which to call.
- **Manage registration by page state.** Register a tool when it is usable in
  the current state; unregister when it is not.
  - Imperative: `registerTool` / `AbortController.abort()`.
  - Declarative: add/remove `toolname` + `tooldescription` on the form.
- **Default to static registration.** For most apps, register once at load.
  Reach for dynamic registration only when state genuinely gates a tool.
- **Trust the agent.** Describe what the tool does, not a rigid step list.
- **Mind the budget.** More tools and more overlap = more context and slower,
  less accurate selection. There is no hard max; experiment.

## 2. Clear language and semantic code

- **Name by exact effect, distinguishing execution from initiation.**
  `create_event` creates immediately; `start_event_creation` redirects to a
  form. Pick the verb that matches what actually happens.
- **Describe what it does and when to use it, in positive language.**
  - Don't: "Don't use this tool for weather." (negative, wastes budget)
  - Do: "Creates a calendar event scheduled for a specific date and time."
  - Limitations should be implicit in a good description.
- **Use semantic HTML** so declarative tools infer accurate schemas and labels.

## 3. Minimize cognitive computing for the model

- **Accept raw user input.** If a user says "11:00 to 15:00", accept it as a
  string; do not ask the model to compute minutes between times.
- **Declare specific parameter types** — `string`, `number`, `enum` — with
  per-property `description`s.
- **Explain the why with natural language, not opaque IDs.** Prefer
  `shipping: "Express"` over `shipping_id: 1`. Self-explanatory choices plus a
  short rationale help the agent choose well.

## 4. Prioritize reliability

- **Graceful failure and rate limits.** Allow reasonable repetition (e.g. price
  comparison). When rate-limited, return a meaningful error or advise the user
  to do it manually.
- **Update interface state after the function completes.** Agents read the UI to
  plan next steps and the UI may lag the function. Confirm completion once the
  interface reflects it, or request an update again.
- **Validate strictly in code, loosely in schema.** Schema constraints are not
  guaranteed. Enforce binary logic in `execute`, and return descriptive errors
  so the model can self-correct and retry with valid parameters.

## 5. Eval testing and debugging

Evals cannot be hard-coded like unit tests — outputs take unanticipated forms.

- **Define the problem like an API contract**: input type, output format,
  constraints.
- **Set a baseline and an ideal result**, especially for text input.
- **Decide how output is judged**: code-based checks for rule-based outputs
  (character limits, enum membership) and LLM-as-a-judge for qualitative
  results (usefulness, task completion).
- **Do not patch a single model with narrow rules.** If a `select` of
  honorifics trips one model, abstract the tool (make the field optional, ask
  the agent to confirm with the user) instead of adding model-specific hacks.

## 6. Debug with the inspector

Install the **Model Context Tool Inspector** Chrome extension to see registered
tools, manually call them, verify the JSON Schema parses, and read structured
output/errors. Drive it with natural-language prompts to confirm the agent
selects and invokes the right tool. See `api-reference.md` for links.

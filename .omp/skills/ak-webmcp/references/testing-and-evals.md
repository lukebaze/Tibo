# WebMCP Testing and Evals

Two layers of verification: **static** (does the tool definition conform?) and
**behavioral** (does an agent select, call, and use the tool correctly?). WebMCP
tools drive probabilistic agents, so behavioral tests are evals, not fixed unit
tests.

## 1. Local setup

1. Chrome 149+ (or Canary). Enable
   `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch. Production sites
   use the Chrome origin trial token instead.
2. Serve over HTTPS (or `localhost`) with an **origin-isolated** document. Do not
   enable `document.domain` / `Origin-Agent-Cluster: ?0` — it disables WebMCP.
3. Install the [Model Context Tool Inspector extension](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd).

## 2. Static self-check

Feature-detect and dump the registered tools in DevTools:

```js
if (!('modelContext' in document)) {
  console.warn('WebMCP unavailable: check HTTPS, origin isolation, flag/OT.');
} else {
  // distrust memory — inspect the live surface
  console.log(Object.getOwnPropertyNames(
    Object.getPrototypeOf(document.modelContext)));
  console.table(await document.modelContext.getTools());
}
```

Run the bundled linter on your source before shipping:

```
node scripts/validate_webmcp.mjs path/to/tools.js path/to/page.html
# --strict promotes heuristic annotation warnings to failures
```

It checks spec rules (name charset, empty name/description, duplicate names,
non-serializable `inputSchema`) as errors and Chrome budgets/annotation hints as
warnings. See `api-reference.md` for the rules.

## 3. Inspector walkthrough

With the extension open on your page you can:

- See which tools are registered (monitors the WebMCP API live).
- Manually call a tool and pass arguments.
- Verify the JSON Schema parses and arguments map as expected.
- Read the structured output / error the tool returns.
- Drive an agent with natural-language prompts to confirm it selects and invokes
  the right tool. Prompts default to a Gemini preview model.

## 4. Eval design

Evals cannot be hard-coded — one input yields many acceptable outputs. Test the
touchpoints with the model:

- Does the model understand the tool's purpose from its `description` + schema?
- Does it pick the right tool with correct parameters for the user intent?
- Does it act on returned information (e.g. feed one tool's output to the next)?
- Can the agent complete the full user journey with your tools?

Keep writing classic deterministic tests for anything that does not touch the
model (tool logic, side effects, returned values).

### Test tools in isolation first

If an agent cannot pick the right tool for "I'd like a small pizza", it will fail
a complex journey. Provide the full tool list for the state under test, then
assert the expected call:

```json
{
  "messages": [{ "role": "user", "content": "I'd like a small pizza." }],
  "expectedCall": [
    { "functionName": "set_pizza_size", "arguments": { "size": "Small" } }
  ]
}
```

`expectedCall` gives a rule-based, deterministic assertion over the model's tool
choice and arguments. Because tools may be registered per component state,
supply the complete tool list that matches the state you are evaluating.

### Deterministic + probabilistic

- **Deterministic tests**: verify tool logic, that dependencies were called, the
  UI updated, and returned values match — mock services like `SearchComponent`.
- **Probabilistic tests (evals)**: needed when a model output must drive the next
  tool call. Include both direct queries ("Add pepperoni") and ambiguous ones
  ("I want all the meat on my pizza") that force reasoning and tool selection.
- Judge output with code-based checks for rule-based results (character limits,
  enum membership) and LLM-as-a-judge for qualitative quality.

### End-to-end journeys

Verify multi-step ordering. Example: "buy a black jacket and jeans, break down
the materials" should drive `search_clothes` → `get_product_details` per item.
Use `expectedCall` sequences, allowing order-independent steps where valid.

## 5. Common failure modes and fixes

| Failure | Likely cause / fix |
| --- | --- |
| Agent calls the wrong tool | Description unclear or schema too similar to another tool; sharpen names/descriptions; ensure the tool is exposed in the current state. |
| Tools called in wrong order | Overlapping descriptions; preceding tool's output missing context the next needs; update UI state after completion. |
| Wrong arguments | `inputSchema` vague; add `enum`s and per-property `description`s; mark required params; explain how to map user input. |
| Output wrong/incomplete | Tool logic bug (catch with deterministic tests); UI state not updated; output too verbose or missing fields the model needs next. |
| Tool throws | Handle runtime errors; return a clear, structured error so the model can tell retryable from fatal. |

## 6. Automated browser runs

For scripted end-to-end runs against a real Chrome with the flag/OT enabled, hand
off to `ak:agent-browser` (or `ak:chrome-profile` for the user's real profile)
rather than adding a browser dependency to this skill. Keep evals reproducible:
fixed prompts, seeded state, recorded expected calls.

## Anti-pattern

Do not patch a single model with narrow rules. If one model mishandles a
`select` of honorifics, abstract the tool (make the field optional, ask the agent
to confirm with the user) instead of adding model-specific hacks — see
`best-practices.md`.

# WebMCP Declarative API

The declarative API turns existing HTML `<form>` elements into WebMCP tools with
attributes. Prefer it when the action is already a form submission — it is the
least code and reuses your native validation and submission logic.

Requires a secure context (HTTPS) and an origin-isolated document, same as the
imperative API.

## Registering a form as a tool

Add two attributes to the `<form>`:

- `toolname`: the tool identifier (same charset rules as imperative names).
- `tooldescription`: what the tool does and when to use it.

```html
<form toolname="createSupportRequest"
      tooldescription="Submits a request for customer support.">
  ...
</form>
```

When an agent calls the tool, the browser focuses the form and populates its
fields. The form stays visible to the user. Removing either `toolname` or
`tooldescription` unregisters the tool.

## Parameters from form fields

Each named form control becomes a tool parameter. The browser infers a JSON
Schema property per control. `<select>` options become an `enum`/`anyOf` with
the option label as the `title`.

Improve accuracy with `toolparamdescription` on a control:

```html
<form toolname="supportRequestTool"
      tooldescription="Submit a request for support."
      action="/submit">
  <label for="firstName">First Name</label>
  <input type="text" name="firstName" id="firstName">

  <label for="lastName">Last Name</label>
  <input type="text" name="lastName" id="lastName">

  <select name="select" required
          toolparamdescription="Determines what team this request is routed to.">
    <option value="Customer happiness team">Return my purchase.</option>
    <option value="Distribution team">Check where my package is.</option>
    <option value="Website support team">Get help on the website.</option>
  </select>

  <button type="submit">Submit</button>
</form>
```

Parameter description precedence when `toolparamdescription` is absent:
1. the associated `<label>` text (skipping nested labelable descendants), then
2. the control's `aria-description`.

`required` controls map to the schema's `required` array.

## Submission

Two options:

- **Manual**: the user clicks **Submit** to complete the task (default).
- **Auto**: add `toolautosubmit` so an agent invocation submits the form and
  triggers navigation.

```html
<form toolautosubmit toolname="search_tool"
      tooldescription="Search the web" action="/search">
  <input type="text" name="query">
</form>
```

### Returning structured results — respondWith

`SubmitEvent` gains:

- `agentInvoked` (boolean): `true` when an AI agent triggered the submit. Adapt
  behavior for agents without changing the human path.
- `respondWith(Promise<any>)`: resolve with the value to serialize back to the
  agent as tool output. You **must** call `preventDefault()` first to stop the
  browser's default submission.

```html
<script>
document.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!myFormIsValid()) {
    if (e.agentInvoked) e.respondWith(myFormValidationErrorPromise);
    return;
  }
  if (e.agentInvoked) e.respondWith(Promise.resolve('Search is done!'));
});
</script>
```

## Events

> **[Proposed]** These events are documented by Chrome but are not yet
> specified (WebMCP spec Issue #146; the imperative form is noted there with the
> US spelling `toolcanceled`). Treat as unstable — see `api-reference.md`.

Fired on `window`, non-cancelable, each with a `toolName` attribute:

- `toolactivated`: an agent executed the tool and the browser pre-filled fields.
- `toolcancel`: the user cancelled the agentic operation or `form.reset()` ran.

```js
window.addEventListener('toolactivated', ({ toolName }) => {
  // update UI / run extra validation
});
window.addEventListener('toolcancel', ({ toolName }) => {
  // let the user know; reset UI
});
```

## Focus indicators (CSS pseudo-classes)

A visible focus indicator tells the user where the agent is acting. The browser
toggles these while a declarative tool is active, then clears them on submit,
cancel, or reset:

- `:tool-form-active` — on the tool's `<form>`.
- `:tool-submit-active` — on the form's submit button (if present).

```css
/* Chrome default declarative form styles */
form:tool-form-active {
  outline: light-dark(blue, cyan) dashed 1px;
  outline-offset: -1px;
}
input:tool-submit-active {
  outline: light-dark(red, pink) dashed 1px;
  outline-offset: -1px;
}
```

## Declarative vs imperative — when to use which

Use **declarative** when:
- the action is a form submission,
- you want to reuse native validation and the visible form UI,
- parameters map cleanly to form controls.

Use **imperative** (`imperative-api.md`) when:
- the action is not a form (state toggle, navigation, custom widget),
- you need dynamic per-state registration or annotations
  (`readOnlyHint`/`consequentialHint`/`untrustedContentHint`),
- you need `exposedTo` cross-origin sharing, `getTools`, or `executeTool`.

You can mix both on the same page.

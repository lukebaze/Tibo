# MCP transport selection and verification

Read the target SDK version, lockfile, server entrypoint and consumer configuration
first. Resolve protocol methods, handshake, schemas, headers and extensions from
that version's official documentation and actual client capabilities. A dated
example is not proof of protocol support.

## Select transport

- stdio: local subprocess consumers. Keep protocol output on stdout and logs on
  stderr. Resolve service credentials without writing login state.
- Streamable HTTP: remote consumers when supported by client and server SDK.
  Validate origins, restrict local bindings, authenticate and authorize each
  operation, and test streaming through the intended proxy.
- Legacy compatibility: add only for an identified consumer. Test the exact
  handshake and lifecycle rather than labeling older clients unsupported.

For Streamable HTTP, choose stateless request handling or a stateful session
only after checking the selected SDK and consumer. Keep business state durable
where the outcome requires it; stateless transport does not make operations
idempotent. Verify retry and reconnect behavior for the chosen lifecycle.

For long-running operations, check whether both ends support protocol tasks.
Use that extension only when supported and needed, with observable completion,
failure and cancellation. Otherwise expose an explicit supported job-status
workflow instead of advertising task methods the consumer cannot call.

## Protocol checklist

Verify version negotiation and initialization/discovery with a real consumer.
Implement resources, prompts, cancellation, notifications or structured content
when the selected SDK/client supports them and the outcome needs them. Do not
invent `server/discover`, `input_required`, cache hints, or retirement of session
IDs, roots, sampling or logging from memory.

Follow the selected version's session lifecycle and HTTP metadata rules. Keep
application continuity explicit and separate from transport internals. Test
stream disconnect/cancellation, timeout, error propagation and proxy buffering.
Do not let a disconnected request orphan work.

## Security and consumer checks

Validate typed inputs/outputs. Return actionable errors and concise human
summaries; use machine structured content when supported. Test invalid input,
authorization denial, redaction and a representative operation through the
actual transport. Bind local HTTP to loopback unless the accepted target requires
remote exposure. Reject invalid origins and enforce audience, issuer and scope
checks for remote authenticated access.

Read `oauth-streamable-http.md` for the OAuth recipe and qualify extensions
against the installed implementation. Read `deployment-guide.md` only for a
selected deployment and `code-mode.md` only for selected sandboxed execution.

## Evidence sources

- [Official MCP specification](https://modelcontextprotocol.io/specification/)
- Installed SDK metadata, versioned docs, types and tests
- Intended consumer configuration and observed connection/tool-call results

Record tested server/SDK, client, protocol and transport with results. Missing
consumer access is a coverage gap, not a passed interoperability test.

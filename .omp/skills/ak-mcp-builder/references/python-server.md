# Python server (`mcp` SDK v2)

Verified against `mcp` 2.2.0 on Python 3.14 with an in-memory `Client`, stdio, and
Streamable HTTP. Check the installed version first: `pip show mcp` or `uv pip show mcp`.
Docs: https://py.sdk.modelcontextprotocol.io/

`MCPServer` (formerly `FastMCP`) lives in the official `mcp` package. The standalone
`fastmcp` project (PrefectHQ, 4.x) is a separate framework built on `mcp` v2; follow its own
docs if the project already uses it. Do not mix the two import styles in one server.

## Setup

```bash
uv init example-mcp && cd example-mcp
uv add "mcp>=2.2,<3" httpx
```

Requires Python ≥ 3.10. Legacy `from mcp.server.fastmcp import FastMCP` code is v1; see the
migration section in `protocol-2026-07-28.md`.

## Complete example (`example_mcp.py`)

The input schema comes from type hints and `Field` constraints; the return annotation
becomes the output schema, and the SDK adds the JSON text block automatically. Parameters
annotated with `Resolve(...)` and the `Context` parameter are hidden from the model.

```python
#!/usr/bin/env python3
"""MCP server for the Example user API (mcp Python SDK v2)."""

import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field

from mcp.server import MCPServer
from mcp.server.mcpserver import Context, Elicit, Resolve
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

API_BASE_URL = os.environ.get("EXAMPLE_API_URL", "https://api.example.com/v1")
CHARACTER_LIMIT = 25_000


@dataclass
class AppState:
    http: httpx.AsyncClient


@asynccontextmanager
async def lifespan(server: MCPServer) -> AsyncIterator[AppState]:
    # Runs once at startup in SDK v2 (not per session).
    async with httpx.AsyncClient(
        base_url=API_BASE_URL,
        headers={"Authorization": f"Bearer {os.environ['EXAMPLE_API_KEY']}"},
        timeout=30.0,
    ) as http:
        yield AppState(http=http)


mcp = MCPServer("example_mcp", lifespan=lifespan)


async def api_request(ctx: Context, method: str, path: str, **kwargs) -> dict:
    """Call the upstream API and turn failures into model-actionable tool errors."""
    http: httpx.AsyncClient = ctx.request_context.lifespan_context.http
    try:
        response = await http.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else {}
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        messages = {
            404: "Not found. Check the ID with example_search_users.",
            403: "Permission denied for this account.",
            429: "Rate limited. Wait before retrying.",
        }
        raise ToolError(messages.get(status, f"Upstream API failed with status {status}.")) from exc
    except httpx.TimeoutException as exc:
        raise ToolError("Upstream API timed out. Retry with a smaller limit.") from exc
    except httpx.HTTPError as exc:
        print(f"upstream error: {exc!r}", file=sys.stderr)  # details stay in server logs
        raise ToolError("Upstream API is unreachable. Retry later.") from exc


class User(BaseModel):
    id: str
    name: str
    email: str


class SearchUsersResult(BaseModel):
    users: list[User]
    total: int
    has_more: bool
    next_offset: int | None = None


@mcp.tool(
    title="Search users",
    annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True),
)
async def example_search_users(
    query: Annotated[str, Field(min_length=2, max_length=200, description="Name or email substring, e.g. 'ana'")],
    ctx: Context,
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> SearchUsersResult:
    """Search users by name or email substring.

    Returns one page of matches with pagination fields. Use example_deactivate_user to change a user.
    """
    data = await api_request(ctx, "GET", "/users", params={"q": query, "limit": limit, "offset": offset})
    users = [User.model_validate(u) for u in data.get("users", [])]
    total = int(data.get("total", len(users)))
    more = offset + len(users) < total
    # Keep the serialized page bounded; shrink the page instead of cutting JSON mid-object.
    while len(users) > 1 and len(SearchUsersResult(users=users, total=total, has_more=True).model_dump_json()) > CHARACTER_LIMIT:
        users = users[: len(users) // 2]
        more = True
    return SearchUsersResult(users=users, total=total, has_more=more, next_offset=offset + len(users) if more else None)


class Confirm(BaseModel):
    confirm: bool = Field(description="Deactivate this user?")


async def confirm_deactivation(user_id: str, ctx: Context, confirm: bool | None = None) -> Confirm | Elicit[Confirm]:
    caps = ctx.client_capabilities
    if caps is not None and caps.elicitation is not None:
        # The client can ask the human, so a model-supplied `confirm` is ignored.
        return Elicit(f"Deactivate user {user_id}?", Confirm)
    if confirm is None:
        raise ToolError(f"Ask the user to approve deactivating {user_id}, then call again with confirm=true.")
    # The model's claim; the host's approval policy for destructive tools is the human gate.
    return Confirm(confirm=confirm)


@mcp.tool(
    title="Deactivate user",
    annotations=ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=True),
)
async def example_deactivate_user(
    user_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")],
    answer: Annotated[Confirm, Resolve(confirm_deactivation)],
    ctx: Context,
    confirm: bool | None = None,
) -> str:
    """Deactivate one user.

    The server asks the user to confirm when the client supports it; otherwise set confirm only
    after the user has explicitly approved this deactivation.
    """
    if not answer.confirm:
        return f"User {user_id} left active."
    await api_request(ctx, "POST", f"/users/{quote(user_id, safe='')}/deactivate")
    return f"User {user_id} deactivated."


if __name__ == "__main__":
    if "EXAMPLE_API_KEY" not in os.environ:
        sys.exit("EXAMPLE_API_KEY is required")
    if os.environ.get("MCP_TRANSPORT") == "http":
        mcp.run(transport="streamable-http", host="127.0.0.1", port=8000)
    else:
        mcp.run()
```

## API notes

- **Tools**: `@mcp.tool(name=?, title=?, description=?, annotations=ToolAnnotations(...),
  icons=?, structured_output=?)`. The docstring is the description. Scalar or list returns
  are wrapped as `{"result": ...}`; return a `BaseModel`, `TypedDict`, or dataclass for a
  named schema. Sync functions run on worker threads; prefer `async def` for I/O.
- **Errors**: raise `ToolError` (from `mcp.server.mcpserver.exceptions`) when the model should
  see and recover from the failure; the client receives `is_error=True` with
  "Error executing tool <name>: <message>". Raise `MCPError(code=..., message=...)` only to
  reject the request itself. Any other exception is logged and sanitized to "Error executing
  tool <name>". Resources raise `ResourceNotFoundError` (`-32602`).
- **Context**: declare `ctx: Context` as a parameter (`get_context()` is gone). Useful members:
  `ctx.request_context.lifespan_context`, `ctx.report_progress(progress, total, message)`,
  `ctx.read_resource(uri)`, `ctx.mcp_server`, `ctx.protocol_version`,
  `ctx.notify_tools_changed()`. `ctx.info()`/logging, `ctx.sample()`, and `ctx.list_roots()`
  belong to deprecated capabilities; log to stderr instead.
- **Interactive input**: `Annotated[T, Resolve(fn)]` runs `fn` before the tool body. `fn` may
  take tool arguments by name, other resolvers, and `ctx`, and may return `Elicit(message,
  Model)`. On 2026-era connections the SDK returns an `input_required` result and resumes on
  retry; on 2025-era connections it sends a classic elicitation request. Annotate the
  parameter as `ElicitationResult[T]` to branch on decline/cancel; with plain `T` a decline
  aborts the call. `ctx.elicit()` raises `NoBackChannelError` on 2026-era connections, so
  prefer `Resolve`. Never elicit passwords or API keys through a form.
- **Lifespan**: `lifespan(server)` runs once at startup; the yielded object is
  `ctx.request_context.lifespan_context`. Put shared clients and pools there, never
  per-user state.
- **Resources and prompts**:

```python
from mcp.server.mcpserver.exceptions import ResourceNotFoundError

@mcp.resource("example://users/{user_id}", mime_type="application/json")
async def user_profile(user_id: str) -> str:
    """One user profile as JSON."""
    user = await find_user(user_id)
    if user is None:
        raise ResourceNotFoundError(f"No user {user_id!r}.")
    return user.model_dump_json()

@mcp.prompt()
def triage_user(user_id: str) -> str:
    """Review a user's recent activity."""
    return f"Review activity for {user_id}."
```

  RFC 6570 URI templates; traversal, absolute paths and null bytes are rejected by default.

## Running

| Mode | Code |
|---|---|
| stdio (default, local clients) | `mcp.run()` |
| Streamable HTTP | `mcp.run(transport="streamable-http", host="127.0.0.1", port=8000)` → `http://127.0.0.1:8000/mcp` |
| Mount in an ASGI app | `app = mcp.streamable_http_app()` |

Transport options belong to `run()`; `MCPServer(..., port=...)` raises `TypeError`.
Host/`Origin` checks (DNS-rebinding protection) switch on automatically only for loopback
binds. For any other host pass `transport_security=TransportSecuritySettings(
enable_dns_rebinding_protection=True, allowed_hosts=[...], allowed_origins=[...])` (from
`mcp.server.transport_security`) to `run()` or `streamable_http_app()`. Do not use
`transport="sse"` for new servers.

## Testing

In-process client, no subprocess or network (pytest + anyio):

```python
import pytest
from mcp import Client
from mcp.types import ElicitResult

from example_mcp import mcp

async def accept(context, params):
    return ElicitResult(action="accept", content={"confirm": True})

@pytest.mark.anyio
async def test_deactivate_asks_first():
    async with Client(mcp, elicitation_callback=accept, raise_exceptions=True) as client:
        result = await client.call_tool("example_deactivate_user", {"user_id": "u1"})
        assert not result.is_error
```

`raise_exceptions=True` surfaces real tracebacks instead of sanitized messages. Stub the
upstream API rather than calling production: set `EXAMPLE_API_URL`/`EXAMPLE_API_KEY` with
`monkeypatch.setenv` before importing the module, pointing at a local HTTP stub.
`Client("http://127.0.0.1:8000/mcp")` and `Client(StdioServerParameters(...))` drive real
transports; `uv run mcp dev example_mcp.py` opens the MCP Inspector.

## Authorization

Serve as an OAuth resource server; the SDK publishes RFC 9728 metadata at
`/.well-known/oauth-protected-resource/mcp` and answers unauthenticated requests with `401`:

```python
from pydantic import AnyHttpUrl
from mcp.server import MCPServer
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.auth.middleware.auth_context import get_access_token

class JwtVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        claims = await verify_jwt(token)  # signature, issuer, expiry, audience
        if claims is None:
            return None
        return AccessToken(token=token, client_id=claims["sub"], scopes=claims["scope"].split(),
                           expires_at=claims["exp"], resource=claims["aud"])

mcp = MCPServer(
    "example_mcp",
    token_verifier=JwtVerifier(),
    auth=AuthSettings(
        issuer_url=AnyHttpUrl("https://auth.example.com"),
        resource_server_url=AnyHttpUrl("https://mcp.example.com/mcp"),
        required_scopes=["users:read"],
        validate_token_resource=True,
    ),
)
# Inside a tool: token = get_access_token()  -> caller identity and scopes
```

Set `validate_token_resource=True` when the AS binds tokens to the RFC 8707 `resource`;
otherwise the verifier must check the audience. Avoid `auth_server_provider=` for new
servers. More: `security-and-auth.md`.

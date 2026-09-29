"""Lightweight connection handling for MCP servers (mcp Python SDK v2)."""

from typing import Any

from mcp import Client, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client


class MCPConnection:
    """Async context manager that wraps an `mcp.Client` for the evaluation harness.

    `mcp.Client` negotiates the protocol era itself: 2026-07-28 servers are served
    statelessly, 2025-era servers through the legacy initialize handshake.
    """

    def __init__(self, target: Any, http_client: Any = None):
        self._target = target
        self._http_client = http_client  # owned here; the transport does not close a passed-in client
        self._client: Client | None = None

    async def __aenter__(self):
        self._client = Client(self._target)
        await self._client.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._client is not None:
            await self._client.__aexit__(exc_type, exc_val, exc_tb)
        self._client = None
        if self._http_client is not None:
            await self._http_client.aclose()

    async def list_tools(self) -> list[dict[str, Any]]:
        """Retrieve available tools from the MCP server."""
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            response = await self._client.list_tools(cursor=cursor)
            tools.extend(
                {"name": tool.name, "description": tool.description or "", "input_schema": tool.input_schema}
                for tool in response.tools
            )
            cursor = response.next_cursor
            if not cursor:
                return tools

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool and return its content blocks plus structured output when present."""
        result = await self._client.call_tool(tool_name, arguments)
        content: list[Any] = [block.model_dump(mode="json", exclude_none=True) for block in result.content]
        if result.structured_content is not None:
            content.append({"structured_content": result.structured_content})
        if result.is_error:
            content.insert(0, {"is_error": True})
        return content


def create_connection(
    transport: str,
    command: str = None,
    args: list[str] = None,
    env: dict[str, str] = None,
    url: str = None,
    headers: dict[str, str] = None,
) -> MCPConnection:
    """Create a connection for "stdio", "http" (Streamable HTTP) or legacy "sse" servers."""
    transport = transport.lower()

    if transport == "stdio":
        if not command:
            raise ValueError("Command is required for stdio transport")
        return MCPConnection(StdioServerParameters(command=command, args=args or [], env=env))

    if transport in ("http", "streamable_http", "streamable-http"):
        if not url:
            raise ValueError("URL is required for http transport")
        http_client = create_mcp_http_client(headers=headers or None)
        return MCPConnection(streamable_http_client(url, http_client=http_client), http_client=http_client)

    if transport == "sse":
        # Deprecated HTTP+SSE transport; only for servers that have not migrated.
        if not url:
            raise ValueError("URL is required for sse transport")
        return MCPConnection(sse_client(url=url, headers=headers or None))

    raise ValueError(f"Unsupported transport type: {transport}. Use 'stdio', 'http', or 'sse'")

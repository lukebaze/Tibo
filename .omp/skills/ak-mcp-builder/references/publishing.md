# Packaging and registry publishing

Only publish when the user asks; publishing is outward-facing and names are hard to
reclaim. Everything here concerns the official MCP Registry, which is still in **preview**
(breaking changes or data resets may occur). Sources:
https://modelcontextprotocol.io/registry/quickstart and
https://modelcontextprotocol.io/registry/package-types

## Before publishing

- The package installs and starts cleanly from the published artifact (`npx`, `uvx`,
  container image) with credentials supplied only by environment variables or OAuth.
- Protocol checks and task evaluations pass (`evaluation-authoring.md`).
- The README documents required environment variables, transports, scopes, and which
  tools are destructive.

## `server.json`

Create with `mcp-publisher init`, then edit:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.<owner>/example-mcp-server",
  "description": "Search and manage Example users.",
  "version": "1.0.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "example-mcp-server",
      "version": "1.0.0",
      "transport": { "type": "stdio" },
      "environmentVariables": [
        { "name": "EXAMPLE_API_KEY", "description": "Example API key", "isRequired": true, "isSecret": true }
      ]
    }
  ]
}
```

Check the schema URL for a newer date before publishing. With GitHub login the `name`
must start with `io.github.<user>/`; DNS or HTTP verification allows your own domain
namespace. `registryType` is one of `npm`, `pypi`, `nuget`, `cargo`, `oci`, `mcpb`.
Remote (HTTP) servers are described with `remotes` instead of, or next to, `packages`.

## Ownership proof per package type

| Package type | Proof |
|---|---|
| npm | `"mcpName": "<server name>"` in `package.json` |
| PyPI / NuGet | `mcp-name: <server name>` in the README (an HTML comment works) |
| Cargo | Same string as visible README text (crates.io strips comments) |
| OCI | `LABEL io.modelcontextprotocol.server.name="<server name>"` |
| MCPB | Download URL contains `mcp`, plus `fileSha256` |

## Publish

```bash
mcp-publisher login github     # or dns / http for a custom namespace
mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=example-mcp-server"
```

Publish the package itself (npm, PyPI, image) first; the registry stores metadata only.
Bump `version` in both the package and `server.json` for every release.

# View Mode

## Execution

Run the server as a background task, so the preview keeps serving while the
session continues. The parameters that make it one are in the block below.

The skill is located at `${CLAUDE_PLUGIN_ROOT}/skills/ak-markdown-novel-viewer/`.

### Stop Server

If `--stop` flag is provided:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/ak-markdown-novel-viewer/scripts/server.cjs --stop
```

### Start Server

Run the `markdown-novel-viewer` server as CC background task with `--foreground` flag:

```bash
INPUT_PATH="<resolved-path>"
if [[ -d "$INPUT_PATH" ]]; then
  node ${CLAUDE_PLUGIN_ROOT}/skills/ak-markdown-novel-viewer/scripts/server.cjs \
    --dir "$INPUT_PATH" --host 0.0.0.0 --open --foreground
else
  node ${CLAUDE_PLUGIN_ROOT}/skills/ak-markdown-novel-viewer/scripts/server.cjs \
    --file "$INPUT_PATH" --host 0.0.0.0 --open --foreground
fi
```

Run the command in the background, or the session blocks until the server stops:
- Set `run_in_background: true`
- Set `timeout: 300000` (5 minutes)
- Parse JSON output and report URL to user

After starting, report:
- Local URL for browser access
- Network URL for remote device access
- Inform user that server is now running as CC background task (visible in `/tasks`)

Display the full URL including its path and query string, because a truncated `host:port` sends the reader to the wrong page.

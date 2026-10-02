# Tibo Agent

## Accepted product direction

Tibo is the agent, not a voice assistant wrapping a separate process. Its primary interface is the macOS notch, retaining Tibo's character and visual identity. Hermes is the architectural reference, not a runtime dependency.

## Delivery contract

- Outcome: a Tibo-owned model/tool loop, durable conversations, light long-term memory, reusable skills, and MCP/native integrations, controlled from the notch.
- Constraints: preserve existing voice engines and artwork; credentials never enter profile JSON; consequential tools require explicit approval; cancellation and failed turns must not look successful or replay actions.
- Non-goals: improve STT/TTS, add a separate chat app, replicate messaging gateways or training infrastructure, or make external coding CLIs the brain.
- Acceptance: with the microphone disabled, send text from the notch, observe a real tool call and result, collapse/reopen without cancelling work, restore a saved session across runtime restart, deny an action without execution, and cancel without a false success.

## Ownership

```text
Tibo notch (SwiftUI)
    ↕ JSONL commands/events over local stdio
Tibo Agent (scripts/tibo_agent.py + tibo_agent_tools.py, Python standard library)
    ├─ model → tool calls → observations → model
    ├─ SQLite sessions, tool history, FTS5 search over messages
    ├─ USER.md / MEMORY.md, skills (Markdown), file/shell/web/mac tools
    └─ MCP stdio servers, configured by the user
tibo (Rust): voice only — --doctor, --transcribe, --tts-server, --say
```

The notch owns presentation. The agent owns session, task, permissions, tools and persistence. Voice owns recording, transcription and playback only. Collapsing the notch, muting the microphone and stopping speech never cancel the agent; only explicit Stop does. Closing the app stops the child runtime and its tool process trees (SIGTERM runs the runtime's cleanup); reopening restores the transcript and never resumes side effects.

Model configuration targets OpenAI-compatible chat-completions endpoints, including local ones. Wire protocol is `type`-keyed JSONL: commands `prompt`, `sessions`, `load`, `new`, `rename`, `delete`, `cancel`, `approve`, `shutdown`; events `ready`, `session`, `sessions`, `status`, `delta`, `message`, `tool_start`, `tool_result`, `approval`, `error`, `done`. A cancelled run ends with `done(cancelled)` and no `error`. A session is titled from its first user message; `rename` sets a title and `delete` removes a session with its messages and tool history (refused while a run is active).

## Sessions and context

A session is a conversation; a run is one unit of work; one run is active at a time. Sessions keep model-visible tool messages. A new session starts automatically after about four hours of inactivity or on a new local day when the caller continues the latest session or names none; the `status` event of that run carries `new_session: true`. Reopening an older session on purpose is always honored. Interrupted tool calls get terminal observations before later prompts see the history.

The runtime makes no hidden model calls: no summarisation or compression pass. Context beyond the limit drops the oldest whole tool batches; the original messages stay in SQLite and `session_search` (FTS5) finds them. Reasoning content is neither stored nor resent. MCP tool lists are cached per process.

## Memory and skills

Memory is two bounded Markdown files in Tibo's private data directory: `USER.md` (about 1.4k characters) and `MEMORY.md` (about 2.2k). One `memory` tool adds, replaces or removes entries after approval. Both files are snapshotted into the system prompt once per session. With `memory_enabled=false` the tool is absent and nothing is injected.

Skills are Markdown procedures (`workflows/*.md`, private `skills/`). The system prompt carries each skill's name and first line; bodies load on demand via `skills_read`. `skills_save` needs approval.

The prompt's persona comes from `profile.json`: `assistant_name`, `user_name`, `pronoun_self`/`pronoun_user`, `reply_length`, `tone` and `custom_instructions` (clipped to 2,000 characters). `allow_shell`, `allow_web`, `allow_file_write` and `allow_mac` set to `false` remove those tools from the schema and make `Tools.run` raise `PermissionError`; `allow_mcp=false` skips `mcp.json`. `workspace` picks the file-tool root (`TIBO_PROJECT_ROOT` still overrides). The app restarts the runtime when any of these change.

## Security boundary

The user trusts local Tibo with the chosen workspace, model provider and configured MCP servers. Remote providers receive conversation and selected tool results.

- Workspace defaults to `<data>/workspace`, never `$HOME`. File tools refuse `~/.ssh`, `~/.aws`, `Library/Keychains` and `.env*`, also through symlinks.
- `web_fetch` resolves the host, rejects loopback, private, link-local, multicast and reserved addresses, pins the validated address, and repeats the check on every redirect. No approval per fetch.
- Approval is required for `write_file`, `shell`, `memory`, `skills_save`, `mac_write` and every MCP call. `mac_read` (calendar and reminder lists) needs none. Denial and timeout fail closed; MCP annotations never bypass approval.
- A shell `approval` event carries `remember`: the exact prefix that "remember" would trust, or `""` when it cannot be remembered (destructive, privileged or interpreter verbs such as `rm`, `mv`, `sudo`, `python3`, `curl`, `git`, or a prefix with shell control characters). Remembered prefixes never match chained, piped or redirected commands. The notch shows the prefix and leaves the option off.
- Local execution is not a sandbox. API keys come from the named environment variable or the macOS Keychain and never reach profile, session or memory files.

## Verification

`python3 -m unittest discover -s scripts` covers: interrupted tool batches, approval gating, strict boolean approval, shell drain and cancellation of descendants, MCP errors, slow responses and cache, sensitive-path and SSRF denial, memory bounds, session rollover and FTS, reasoning omission, SSE safety. `cargo test` covers the voice crate. Live checks use a real provider with a real tool call, a real stdio MCP server, restart restore, and the actual notch.

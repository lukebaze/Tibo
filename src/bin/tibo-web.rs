use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, ChildStdout, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const INDEX_HTML: &str = include_str!("../../web/index.html");
const APP_CSS: &str = include_str!("../../web/app.css");
const APP_JS: &str = include_str!("../../web/app.js");
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;
fn system_prompt() -> String {
    let profile = tibo::profile::load();
    let name = if profile.assistant_name.trim().is_empty() {
        "Tibo"
    } else {
        profile.assistant_name.as_str()
    };
    let user = if profile.user_name.trim().is_empty() {
        String::new()
    } else {
        format!(" Người dùng tên là {}.", profile.user_name.trim())
    };
    format!("Bạn là {name}, trợ lý giọng nói trên macOS.{user} Câu trả lời sẽ được đọc thành tiếng, nên hãy nói như đang trò chuyện: thật ngắn gọn, thường một câu, tối đa hai câu, đi thẳng vào ý chính. Dùng tiếng Việt tự nhiên, thân thiện; không Markdown, không gạch đầu dòng, không emoji, không rào đón, không nhắc lại câu hỏi. Kể cả khi được hỏi \"giải thích\" hay \"là gì\", chỉ nêu ý cốt lõi trong một hai câu; chỉ nói dài khi người dùng nói rõ muốn nghe chi tiết. Không tuyên bố đã thao tác trên máy; thao tác được xử lý bởi nhánh computer-use riêng.")
}

#[derive(Deserialize)]
struct TurnRequest {
    transcript: String,
    #[serde(default)]
    interrupted: bool,
}

#[derive(Deserialize)]
struct SpeechRequest {
    text: String,
    voice: String,
}

#[derive(Deserialize)]
struct NativeAction {
    action: String,
    target: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WebEvent {
    State {
        state: String,
        detail: String,
    },
    Log {
        at_ms: u128,
        source: String,
        stream: String,
        line: String,
    },
    Transcript {
        text: String,
    },
    Route {
        data: Value,
    },
    ResponseDelta {
        text: String,
    },
    ResponseDone,
    NativeAction {
        action: String,
        target: String,
        status: String,
        message: String,
    },
    Error {
        code: String,
        message: String,
    },
    Done {
        exit_code: i32,
    },
}

struct AppState {
    token: String,
    origin: String,
    alternate_origin: String,
    started: Instant,
    busy: AtomicBool,
    cancelled: AtomicBool,
    active_pid: Mutex<Option<u32>>,
    tts_engines: Mutex<HashMap<String, tibo::tts::TtsEngine>>,
}

#[derive(Clone)]
struct EventWriter {
    stream: Arc<Mutex<TcpStream>>,
    started: Instant,
}

impl EventWriter {
    fn send(&self, event: WebEvent) -> bool {
        let Ok(mut stream) = self.stream.lock() else {
            return false;
        };
        if serde_json::to_writer(&mut *stream, &event).is_err()
            || stream.write_all(b"\n").is_err()
            || stream.flush().is_err()
        {
            return false;
        }
        true
    }

    fn log(&self, source: &str, stream: &str, line: &str) -> bool {
        self.send(WebEvent::Log {
            at_ms: self.started.elapsed().as_millis(),
            source: source.into(),
            stream: stream.into(),
            line: redact_log(line),
        })
    }
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct BusyGuard(Arc<AppState>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
        if let Ok(mut pid) = self.0.active_pid.lock() {
            *pid = None;
        }
    }
}

struct RunningChild {
    child: Child,
    stdout: BufReader<ChildStdout>,
    stderr_thread: thread::JoinHandle<()>,
    pid: u32,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("TIBO_WEB_ERROR {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let port = env::var("TIBO_WEB_PORT")
        .unwrap_or_else(|_| "7878".into())
        .parse::<u16>()
        .map_err(|_| "TIBO_WEB_PORT must be a valid TCP port".to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|error| error.to_string())?;
    let state = Arc::new(AppState {
        token: random_token()?,
        origin: format!("http://127.0.0.1:{port}"),
        alternate_origin: format!("http://localhost:{port}"),
        started: Instant::now(),
        busy: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        active_pid: Mutex::new(None),
        tts_engines: Mutex::new(HashMap::new()),
    });
    println!("TIBO_WEB http://127.0.0.1:{port}");
    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                let state = Arc::clone(&state);
                thread::spawn(move || handle_connection(stream, state));
            }
            Err(error) => eprintln!("TIBO_WEB accept_failed {error}"),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: Arc<AppState>) {
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(error) => {
            write_json_error(&mut stream, 400, "invalid_request", &error);
            return;
        }
    };
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/") => {
            let html = INDEX_HTML.replace("__TIBO_TOKEN__", &state.token);
            write_response(
                &mut stream,
                200,
                "text/html; charset=utf-8",
                html.as_bytes(),
            );
        }
        ("GET", "/app.css") => {
            write_response(
                &mut stream,
                200,
                "text/css; charset=utf-8",
                APP_CSS.as_bytes(),
            );
        }
        ("GET", "/app.js") => {
            write_response(
                &mut stream,
                200,
                "text/javascript; charset=utf-8",
                APP_JS.as_bytes(),
            );
        }
        ("GET", "/api/v1/health") => write_json(
            &mut stream,
            200,
            &serde_json::json!({
                "data": {
                    "status": "ok",
                    "busy": state.busy.load(Ordering::Acquire),
                    "uptime_ms": state.started.elapsed().as_millis()
                }
            }),
        ),
        ("POST", "/api/v1/speech") => handle_speech(&mut stream, &request, &state),
        ("POST", "/api/v1/turns") => {
            if !authorized(&request, &state) {
                write_json_error(
                    &mut stream,
                    401,
                    "unauthorized",
                    "Invalid local session token",
                );
                return;
            }
            if !request
                .headers
                .get("content-type")
                .is_some_and(|value| value.starts_with("application/json"))
            {
                write_json_error(
                    &mut stream,
                    415,
                    "unsupported_media_type",
                    "Content-Type must be application/json",
                );
                return;
            }
            let turn: TurnRequest = match serde_json::from_slice(&request.body) {
                Ok(turn) => turn,
                Err(_) => {
                    write_json_error(&mut stream, 400, "invalid_json", "Malformed JSON body");
                    return;
                }
            };
            if let Err(message) = validate_turn(&turn) {
                write_json_error(&mut stream, 422, "invalid_transcript", message);
                return;
            }
            if state
                .busy
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                write_json_error(
                    &mut stream,
                    409,
                    "turn_in_progress",
                    "Cancel the active turn before starting another",
                );
                return;
            }
            state.cancelled.store(false, Ordering::Release);
            let _guard = BusyGuard(Arc::clone(&state));
            if write_stream_headers(&mut stream).is_err() {
                return;
            }
            let writer = EventWriter {
                stream: Arc::new(Mutex::new(stream)),
                started: Instant::now(),
            };
            execute_turn(turn, &state, &writer);
        }
        ("POST", "/api/v1/turns/current/cancel") => {
            if !authorized(&request, &state) {
                write_json_error(
                    &mut stream,
                    401,
                    "unauthorized",
                    "Invalid local session token",
                );
                return;
            }
            cancel_active(&state);
            write_empty(&mut stream, 204);
        }
        _ => write_json_error(&mut stream, 404, "not_found", "Route not found"),
    }
}

fn handle_speech(stream: &mut TcpStream, request: &Request, state: &AppState) {
    if !authorized(request, state) {
        write_json_error(stream, 401, "unauthorized", "Invalid local session token");
        return;
    }
    if !request
        .headers
        .get("content-type")
        .is_some_and(|value| value.starts_with("application/json"))
    {
        write_json_error(
            stream,
            415,
            "unsupported_media_type",
            "Content-Type must be application/json",
        );
        return;
    }
    let speech: SpeechRequest = match serde_json::from_slice(&request.body) {
        Ok(speech) => speech,
        Err(_) => {
            write_json_error(stream, 400, "invalid_json", "Malformed JSON body");
            return;
        }
    };
    let text = speech.text.trim();
    if text.is_empty()
        || text.chars().count() > 2_000
        || text
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        write_json_error(stream, 422, "invalid_text", "Speech text is invalid");
        return;
    }
    if !matches!(
        speech.voice.as_str(),
        "mai_linh" | "diem_trinh" | "ngoc_huyen"
    ) {
        write_json_error(stream, 422, "invalid_voice", "Unknown Vietnamese voice");
        return;
    }

    let synthesis = match state.tts_engines.lock() {
        Ok(mut engines) => {
            if !engines.contains_key(&speech.voice) {
                let engine = match tibo::tts::TtsEngine::start_with_voice(&speech.voice) {
                    Ok(engine) => engine,
                    Err(message) => {
                        write_json_error(stream, 500, "tts_start_failed", &message);
                        return;
                    }
                };
                engines.insert(speech.voice.clone(), engine);
            }
            let result = engines
                .get_mut(&speech.voice)
                .expect("voice engine was inserted")
                .synthesize(text);
            if result.is_err() {
                engines.remove(&speech.voice);
            }
            result
        }
        Err(_) => Err("TTS engine lock is unavailable".into()),
    };
    let wav = match synthesis {
        Ok(path) => path,
        Err(message) => {
            write_json_error(stream, 500, "tts_failed", &message);
            return;
        }
    };
    let audio = fs::read(&wav);
    let _ = fs::remove_file(&wav);
    match audio {
        Ok(audio) => write_response(stream, 200, "audio/wav", &audio),
        Err(error) => write_json_error(stream, 500, "tts_read_failed", &error.to_string()),
    }
}

fn execute_turn(turn: TurnRequest, state: &Arc<AppState>, writer: &EventWriter) {
    writer.send(WebEvent::State {
        state: "processing".into(),
        detail: "Routing request".into(),
    });
    writer.log("system", "event", "turn accepted");

    let backend = env::var_os("TIBO_BACKEND")
        .map(PathBuf::from)
        .unwrap_or_else(|| sibling_executable("tibo"));
    let configured = tibo::profile::load();
    let transcript = addressed_transcript(turn.transcript.trim(), &configured.assistant_name);
    let mut command = Command::new(backend);
    command.args(["--text", &transcript, "--emit-text"]);
    if turn.interrupted {
        command.arg("--interrupted");
    }

    let running = match start_process(&mut command, "backend", state, writer) {
        Ok(running) => running,
        Err(error) => {
            writer.send(WebEvent::Error {
                code: "backend_start_failed".into(),
                message: error,
            });
            writer.send(WebEvent::Done { exit_code: -1 });
            return;
        }
    };
    let RunningChild {
        mut child,
        stdout,
        stderr_thread,
        pid,
    } = running;
    let mut llm_prompt = None;
    let mut native_action_failed = false;
    for line in stdout.lines() {
        let Ok(line) = line else { break };
        if !writer.log("backend", "stdout", &line) {
            cancel_active(state);
            break;
        }
        if let Some(text) = line.strip_prefix("TRANSCRIPT: ") {
            writer.send(WebEvent::Transcript { text: text.into() });
        } else if let Some(payload) = line.strip_prefix("TIBO_ROUTE_RESULT ") {
            if let Ok(data) = serde_json::from_str(payload) {
                writer.send(WebEvent::Route { data });
            }
        } else if let Some(payload) = line.strip_prefix("TIBO_NATIVE_ACTION ") {
            match serde_json::from_str::<NativeAction>(payload)
                .map_err(|_| "Malformed native action".to_string())
                .and_then(execute_native_action)
            {
                Ok((action, target, message)) => {
                    writer.send(WebEvent::NativeAction {
                        action,
                        target,
                        status: "succeeded".into(),
                        message,
                    });
                }
                Err(message) => {
                    native_action_failed = true;
                    writer.send(WebEvent::NativeAction {
                        action: "open_app".into(),
                        target: String::new(),
                        status: "failed".into(),
                        message: message.clone(),
                    });
                    writer.send(WebEvent::ResponseDelta { text: message });
                    writer.send(WebEvent::ResponseDone);
                }
            }
        } else if let Some(payload) = line.strip_prefix("TIBO_SAY ") {
            if !native_action_failed {
                if let Ok(text) = serde_json::from_str::<String>(payload) {
                    writer.send(WebEvent::ResponseDelta { text });
                    writer.send(WebEvent::ResponseDone);
                }
            }
        } else if let Some(payload) = line.strip_prefix("TIBO_LLM_REQUEST ") {
            // {"prompt","context"}: context is Tibo's memory block, appended to the system prompt.
            llm_prompt = serde_json::from_str::<Value>(payload).ok().and_then(|request| {
                let prompt = request["prompt"].as_str()?.to_string();
                Some((prompt, request["context"].as_str().unwrap_or_default().to_string()))
            });
        }
        if state.cancelled.load(Ordering::Acquire) {
            break;
        }
    }
    let status = finish_process(&mut child, stderr_thread, pid, state);
    let exit_code = status
        .as_ref()
        .ok()
        .and_then(ExitStatus::code)
        .unwrap_or(-1);
    writer.log(
        "system",
        "event",
        &format!("backend exited with {exit_code}"),
    );

    if state.cancelled.load(Ordering::Acquire) {
        writer.send(WebEvent::State {
            state: "cancelled".into(),
            detail: "Foreground response cancelled".into(),
        });
        writer.send(WebEvent::Done { exit_code });
        return;
    }
    if !status.is_ok_and(|status| status.success()) {
        writer.send(WebEvent::Error {
            code: "backend_failed".into(),
            message: "The assistant backend exited before completing the turn".into(),
        });
        writer.send(WebEvent::Done { exit_code });
        return;
    }
    if let Some((prompt, context)) = llm_prompt {
        stream_claude(prompt, &context, state, writer);
    } else {
        writer.send(WebEvent::State {
            state: "ready".into(),
            detail: "Turn complete".into(),
        });
        writer.send(WebEvent::Done { exit_code });
    }
}

fn stream_claude(prompt: String, context: &str, state: &Arc<AppState>, writer: &EventWriter) {
    writer.send(WebEvent::State {
        state: "thinking".into(),
        detail: "Streaming Claude response".into(),
    });
    let claude = env::var_os("TIBO_CLAUDE")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".nvm/versions/node/v26.2.0/bin/claude"));
    let mut system = system_prompt();
    if !context.is_empty() {
        system.push_str("\n\n");
        system.push_str(context);
    }
    let mut command = Command::new(claude);
    command.args([
        "-p",
        &prompt,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--permission-mode",
        "plan",
        "--no-session-persistence",
        "--tools",
        "",
        "--system-prompt",
        &system,
    ]);
    let running = match start_process(&mut command, "claude", state, writer) {
        Ok(running) => running,
        Err(error) => {
            let fallback = "Tôi chưa thể trả lời lúc này.".to_string();
            writer.send(WebEvent::Error {
                code: "claude_start_failed".into(),
                message: error,
            });
            writer.send(WebEvent::ResponseDelta { text: fallback });
            writer.send(WebEvent::ResponseDone);
            writer.send(WebEvent::Done { exit_code: -1 });
            return;
        }
    };
    let RunningChild {
        mut child,
        stdout,
        stderr_thread,
        pid,
    } = running;
    let mut received_text = false;
    let mut answer = String::new();
    let mut final_sent = false;
    for line in stdout.lines() {
        let Ok(line) = line else { break };
        if !writer.log("claude", "stdout", &line) {
            cancel_active(state);
            break;
        }
        let Ok(object) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if object.get("type").and_then(Value::as_str) == Some("stream_event")
            && object.pointer("/event/type").and_then(Value::as_str) == Some("content_block_delta")
            && object.pointer("/event/delta/type").and_then(Value::as_str) == Some("text_delta")
        {
            if let Some(text) = object
                .pointer("/event/delta/text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
            {
                received_text = true;
                answer.push_str(text);
                writer.send(WebEvent::ResponseDelta { text: text.into() });
            }
        } else if object.get("type").and_then(Value::as_str) == Some("result") {
            writer.send(WebEvent::ResponseDone);
            final_sent = true;
        }
        if state.cancelled.load(Ordering::Acquire) {
            break;
        }
    }
    let status = finish_process(&mut child, stderr_thread, pid, state);
    let exit_code = status
        .as_ref()
        .ok()
        .and_then(ExitStatus::code)
        .unwrap_or(-1);
    writer.log(
        "system",
        "event",
        &format!("claude exited with {exit_code}"),
    );
    if state.cancelled.load(Ordering::Acquire) {
        writer.send(WebEvent::State {
            state: "cancelled".into(),
            detail: "Foreground response cancelled".into(),
        });
    } else if !status.is_ok_and(|status| status.success()) && !received_text {
        writer.send(WebEvent::Error {
            code: "claude_failed".into(),
            message: "Claude exited before producing text".into(),
        });
        writer.send(WebEvent::ResponseDelta {
            text: "Tôi chưa thể trả lời lúc này.".into(),
        });
        writer.send(WebEvent::ResponseDone);
    } else {
        if !final_sent {
            writer.send(WebEvent::ResponseDone);
        }
        tibo::memory::log_turn(&prompt, &answer, "conversation");
        writer.send(WebEvent::State {
            state: "ready".into(),
            detail: "Turn complete".into(),
        });
    }
    writer.send(WebEvent::Done { exit_code });
}

fn start_process(
    command: &mut Command,
    source: &str,
    state: &Arc<AppState>,
    writer: &EventWriter,
) -> Result<RunningChild, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let pid = child.id();
    if let Ok(mut active_pid) = state.active_pid.lock() {
        *active_pid = Some(pid);
    }
    if state.cancelled.load(Ordering::Acquire) {
        let _ = child.kill();
    }
    let stdout = child
        .stdout
        .take()
        .map(BufReader::new)
        .ok_or_else(|| "child stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child stderr unavailable".to_string())?;
    let source = source.to_string();
    let writer = writer.clone();
    let stderr_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !writer.log(&source, "stderr", &line) {
                break;
            }
        }
    });
    Ok(RunningChild {
        child,
        stdout,
        stderr_thread,
        pid,
    })
}

fn finish_process(
    child: &mut Child,
    stderr_thread: thread::JoinHandle<()>,
    pid: u32,
    state: &Arc<AppState>,
) -> Result<ExitStatus, std::io::Error> {
    let status = child.wait();
    let _ = stderr_thread.join();
    if let Ok(mut active_pid) = state.active_pid.lock() {
        if *active_pid == Some(pid) {
            *active_pid = None;
        }
    }
    status
}

fn execute_native_action(action: NativeAction) -> Result<(String, String, String), String> {
    let target = action.target.trim();
    let length = target.chars().count();
    if action.action != "open_app"
        || !(1..=80).contains(&length)
        || target.chars().any(char::is_control)
    {
        return Err("Tên ứng dụng không hợp lệ.".into());
    }
    let status = Command::new("/usr/bin/open")
        .args(["-a", target])
        .status()
        .map_err(|_| format!("Không mở được {target}."))?;
    if !status.success() {
        return Err(format!("Không mở được {target}."));
    }
    Ok((action.action, target.into(), format!("Đã mở {target}.")))
}

fn cancel_active(state: &Arc<AppState>) {
    state.cancelled.store(true, Ordering::Release);
    let pid = state.active_pid.lock().ok().and_then(|pid| *pid);
    if let Some(pid) = pid {
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(2048);
    let mut buffer = [0u8; 2048];
    let header_end = loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("Connection closed before request completed".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(index) = find_bytes(&bytes, b"\r\n\r\n") {
            break index + 4;
        }
        if bytes.len() > MAX_HEADER_BYTES {
            return Err("Request headers are too large".into());
        }
    };
    if header_end > MAX_HEADER_BYTES {
        return Err("Request headers are too large".into());
    }
    let header = std::str::from_utf8(&bytes[..header_end - 4])
        .map_err(|_| "Request headers must be UTF-8".to_string())?;
    let mut lines = header.split("\r\n");
    let mut request_line = lines
        .next()
        .ok_or_else(|| "Missing request line".to_string())?
        .split_whitespace();
    let method = request_line
        .next()
        .ok_or_else(|| "Missing HTTP method".to_string())?
        .to_string();
    let path = request_line
        .next()
        .ok_or_else(|| "Missing request path".to_string())?
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    let mut headers = HashMap::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            return Err("Malformed request header".into());
        };
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    if headers.contains_key("transfer-encoding") {
        return Err("Chunked request bodies are not supported".into());
    }
    let content_length = headers
        .get("content-length")
        .map(|value| value.parse::<usize>())
        .transpose()
        .map_err(|_| "Invalid Content-Length".to_string())?
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err("Request body is too large".into());
    }
    while bytes.len() < header_end + content_length {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("Connection closed before body completed".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(Request {
        method,
        path,
        headers,
        body: bytes[header_end..header_end + content_length].to_vec(),
    })
}

fn authorized(request: &Request, state: &AppState) -> bool {
    let token_valid = request
        .headers
        .get("x-tibo-token")
        .is_some_and(|token| token == &state.token);
    let origin_valid = request
        .headers
        .get("origin")
        .is_none_or(|origin| origin == &state.origin || origin == &state.alternate_origin);
    token_valid && origin_valid
}

fn addressed_transcript(transcript: &str, assistant_name: &str) -> String {
    if tibo::audio::wake_matched(transcript) {
        transcript.into()
    } else {
        let name = if assistant_name.trim().is_empty() {
            "Tibo"
        } else {
            assistant_name.trim()
        };
        format!("{name} {transcript}")
    }
}

fn validate_turn(turn: &TurnRequest) -> Result<(), &'static str> {
    let transcript = turn.transcript.trim();
    let length = transcript.chars().count();
    if length == 0 {
        return Err("Transcript is required");
    }
    if length > 4_000 {
        return Err("Transcript must be at most 4000 characters");
    }
    if transcript.chars().any(char::is_control) {
        return Err("Transcript contains control characters");
    }
    Ok(())
}

fn write_stream_headers(stream: &mut TcpStream) -> std::io::Result<()> {
    stream.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
    )?;
    stream.flush()
}

fn write_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    let headers = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        reason(status),
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn write_json(stream: &mut TcpStream, status: u16, value: &Value) {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    write_response(stream, status, "application/json; charset=utf-8", &body);
}

fn write_json_error(stream: &mut TcpStream, status: u16, code: &str, message: &str) {
    write_json(
        stream,
        status,
        &serde_json::json!({"error": {"code": code, "message": message}}),
    );
}

fn write_empty(stream: &mut TcpStream, status: u16) {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        reason(status)
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        _ => "Error",
    }
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| error.to_string())?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(64);
    for byte in bytes {
        token.push(HEX[(byte >> 4) as usize] as char);
        token.push(HEX[(byte & 15) as usize] as char);
    }
    Ok(token)
}

fn redact_log(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    if lower.contains("authorization:")
        || lower.contains("bearer ")
        || lower.contains("typesafe_api_key")
        || lower.contains("anthropic_api_key")
        || lower.contains("openai_api_key")
    {
        return "[sensitive log line redacted]".into();
    }
    let mut redacted = String::with_capacity(line.len());
    let mut remaining = line;
    while let Some(start) = remaining.find("sk-") {
        redacted.push_str(&remaining[..start]);
        redacted.push_str("[redacted]");
        let token = &remaining[start + 3..];
        let length = token
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            .count();
        remaining = &token[length..];
    }
    redacted.push_str(remaining);
    redacted
}

fn sibling_executable(name: &str) -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join(name)))
        .unwrap_or_else(|| PathBuf::from(name))
}

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_validation_rejects_empty_oversized_and_control_input() {
        assert!(validate_turn(&TurnRequest {
            transcript: " ".into(),
            interrupted: false,
        })
        .is_err());
        assert!(validate_turn(&TurnRequest {
            transcript: "a".repeat(4_001),
            interrupted: false,
        })
        .is_err());
        assert!(validate_turn(&TurnRequest {
            transcript: "hello\nworld".into(),
            interrupted: false,
        })
        .is_err());
    }

    #[test]
    fn web_turns_are_addressed_without_duplicating_the_wake_word() {
        assert_eq!(addressed_transcript("mở Safari", "Tibo"), "Tibo mở Safari");
        assert_eq!(
            addressed_transcript("Tibo mở Safari", "Tibo"),
            "Tibo mở Safari"
        );
    }

    #[test]
    fn operational_logs_redact_credentials_without_changing_other_lines() {
        assert_eq!(
            redact_log("Authorization: Bearer secret"),
            "[sensitive log line redacted]"
        );
        assert_eq!(redact_log("token sk-example-secret"), "token [redacted]");
        assert_eq!(redact_log("a  b"), "a  b");
    }

    #[test]
    fn local_api_requires_token_and_same_origin() {
        let state = AppState {
            token: "secret".into(),
            origin: "http://127.0.0.1:7878".into(),
            alternate_origin: "http://localhost:7878".into(),
            started: Instant::now(),
            busy: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            active_pid: Mutex::new(None),
            tts_engines: Mutex::new(HashMap::new()),
        };
        let mut headers = HashMap::from([
            ("x-tibo-token".into(), "secret".into()),
            ("origin".into(), "http://127.0.0.1:7878".into()),
        ]);
        let request = |headers| Request {
            method: "POST".into(),
            path: "/api/v1/turns".into(),
            headers,
            body: Vec::new(),
        };
        assert!(authorized(&request(headers.clone()), &state));
        headers.insert("origin".into(), "https://example.com".into());
        assert!(!authorized(&request(headers.clone()), &state));
        headers.remove("x-tibo-token");
        assert!(!authorized(&request(headers), &state));
    }
}

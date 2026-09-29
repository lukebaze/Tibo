use tibo::{
    audio, handlers,
    jev::{Answer, Answers, JevClient},
    memory, policy,
    profile,
    questions::{self, Thresholds, Turn},
    session, tts, workflow,
};
use std::{
    collections::HashSet,
    env, fs,
    io::{self, Read, Write},
    path::PathBuf,
    process::{Command, ExitCode},
};

use serde::{Deserialize, Serialize};

const COMPUTER_PLAN_NO_MATCH: &str = "no_match";
const COMPUTER_PLAN_CONFIDENCE_MIN: f64 = 0.6;
const COMPUTER_PLAN_AMBIGUITY_MARGIN: f64 = 0.15;
const COMPUTER_PLAN_MAX_CANDIDATES: usize = 253;
const COMPUTER_PLAN_MAX_QUERY_CHARS: usize = 4096;
const COMPUTER_PLAN_MAX_ID_CHARS: usize = 256;
const COMPUTER_PLAN_MAX_FIELD_CHARS: usize = 4096;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ComputerPlanRequest {
    query: String,
    candidates: Vec<ComputerPlanCandidate>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ComputerPlanCandidate {
    id: String,
    title: String,
    detail: String,
}

#[derive(Default)]
struct Args {
    voice: bool,
    audio: Option<PathBuf>,
    model: Option<PathBuf>,
    record_seconds: u64,
    speak: bool,
    emit_wav: bool,
    emit_text: bool,
    tts_server: bool,
    text: Option<String>,
    transcribe: Option<PathBuf>,
    say: Option<String>,
    doctor: bool,
    smoke: bool,
    route_test: bool,
    no_jev: bool,
    interrupted: bool,
    /// The user addressed Tibo explicitly (typed, or tapped the mic): no wake word needed.
    addressed: bool,
    /// Tibo answered recently (the app's 15-minute conversation window).
    conversation: bool,
    prefix: Option<String>,
    language: Option<String>,
    prompt: Option<String>,
    eval: bool,
    eval_run: bool,
    approve_run: bool,
    eval_run_id: Option<String>,
    /// App-side turn log: `{"user","tibo","route"}` for chat/screen answers streamed by the app's agent.
    log_turn: Option<String>,
    /// Internal: detached daily memory consolidation spawned by `memory::maybe_consolidate`.
    consolidate_memory: Option<String>,
    computer_plan: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("TIBO_ERROR {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    if args.computer_plan {
        return computer_plan();
    }
    if args.tts_server {
        return tts::serve();
    }
    if args.doctor {
        return doctor();
    }
    if args.eval || args.eval_run {
        return legacy_eval(&args);
    }
    if let Some(json) = &args.log_turn {
        let entry: serde_json::Value =
            serde_json::from_str(json).map_err(|e| format!("--log-turn: {e}"))?;
        let field = |key: &str| entry[key].as_str().unwrap_or_default().to_string();
        memory::log_turn(&field("user"), &field("tibo"), &field("route"));
        return Ok(());
    }
    if let Some(day) = &args.consolidate_memory {
        return memory::consolidate(day);
    }
    if let Some(wav) = &args.transcribe {
        audio::validate_wav(wav)?;
        println!("{}", audio::transcribe(wav, None, None, None)?);
        return Ok(());
    }
    if let Some(text) = &args.say {
        return tts::output(text, args.emit_wav);
    }
    if args.route_test {
        return route_test();
    }
    if args.smoke {
        env::set_var(
            "TIBO_JEV_FIXTURE",
            concat!(env!("CARGO_MANIFEST_DIR"), "/bench/smoke_fixture.json"),
        );
        return process_turn("Tibo show OMP agents".into(), &args);
    }
    let transcript = if args.voice {
        let wav = match &args.audio {
            Some(path) => {
                audio::validate_wav(path)?;
                path.clone()
            }
            None => audio::capture(args.record_seconds, None)?,
        };
        audio::transcribe(
            &wav,
            args.model.as_deref(),
            args.language.as_deref(),
            args.prompt.as_deref(),
        )?
    } else if let Some(text) = &args.text {
        text.clone()
    } else {
        return Err(
            "use --voice, --text, --transcribe, --say, --tts-server, --computer-plan, --doctor, --smoke, --route-test, or --eval"
                .into(),
        );
    };
    process_turn(transcript, &args)
}

fn computer_plan() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .take(1_000_001)
        .read_to_string(&mut input)
        .map_err(|e| format!("--computer-plan stdin: {e}"))?;
    if input.len() > 1_000_000 {
        return Err("--computer-plan input exceeds 1 MB".into());
    }
    let request: ComputerPlanRequest =
        serde_json::from_str(&input).map_err(|e| format!("--computer-plan input: {e}"))?;
    validate_computer_plan_request(&request)?;

    let state = serde_json::json!({ "query": &request.query });
    let questions = computer_plan_questions(&request.candidates);
    let answers = JevClient::from_env()
        .map_err(|e| format!("--computer-plan Jev: {e}"))?
        .system_one(&state, &questions)
        .map_err(|e| format!("--computer-plan Jev: {e}"))?;
    let id = select_computer_plan_candidate(&answers, &request.candidates)?;
    let output = serde_json::to_string(&serde_json::json!({ "id": id }))
        .map_err(|e| format!("--computer-plan output: {e}"))?;
    io::stdout()
        .write_all(output.as_bytes())
        .and_then(|_| io::stdout().flush())
        .map_err(|e| format!("--computer-plan stdout: {e}"))
}

fn validate_computer_plan_request(request: &ComputerPlanRequest) -> Result<(), String> {
    if request.candidates.len() > COMPUTER_PLAN_MAX_CANDIDATES {
        return Err(format!(
            "--computer-plan accepts fewer than 254 candidates (got {})",
            request.candidates.len()
        ));
    }
    validate_computer_plan_text("query", &request.query, COMPUTER_PLAN_MAX_QUERY_CHARS, false)?;
    let mut ids = HashSet::with_capacity(request.candidates.len());
    for candidate in &request.candidates {
        validate_computer_plan_text("candidate id", &candidate.id, COMPUTER_PLAN_MAX_ID_CHARS, false)?;
        if candidate.id == COMPUTER_PLAN_NO_MATCH {
            return Err(format!(
                "candidate id is reserved: {COMPUTER_PLAN_NO_MATCH}"
            ));
        }
        if !ids.insert(&candidate.id) {
            return Err(format!("duplicate candidate id: {}", candidate.id));
        }
        validate_computer_plan_text(
            "candidate title",
            &candidate.title,
            COMPUTER_PLAN_MAX_FIELD_CHARS,
            true,
        )?;
        validate_computer_plan_text(
            "candidate detail",
            &candidate.detail,
            COMPUTER_PLAN_MAX_FIELD_CHARS,
            true,
        )?;
    }
    Ok(())
}

fn validate_computer_plan_text(
    field: &str,
    value: &str,
    max_chars: usize,
    allow_empty: bool,
) -> Result<(), String> {
    let length = value.chars().count();
    if (!allow_empty && value.trim().is_empty()) || length > max_chars {
        return Err(format!(
            "invalid {field}: expected {}..{max_chars} characters",
            if allow_empty { 0 } else { 1 }
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("invalid {field}: control characters are not allowed"));
    }
    Ok(())
}

fn computer_plan_questions(candidates: &[ComputerPlanCandidate]) -> serde_json::Value {
    let mut criteria = serde_json::Map::with_capacity(candidates.len() + 1);
    for candidate in candidates {
        criteria.insert(
            candidate.id.clone(),
            serde_json::Value::String(format!(
                "Select {} — {}",
                candidate.title, candidate.detail
            )),
        );
    }
    criteria.insert(
        COMPUTER_PLAN_NO_MATCH.into(),
        serde_json::Value::String("No candidate is a safe or sufficiently clear match.".into()),
    );
    serde_json::json!({
        "selection": {
            "type": "choice",
            "instructions": "Select exactly one supplied candidate only when it best matches the query; choose no_match when the query is ambiguous, unsupported, or no candidate is a safe match.",
            "criteria": criteria
        }
    })
}

fn select_computer_plan_candidate(
    answers: &Answers,
    candidates: &[ComputerPlanCandidate],
) -> Result<Option<String>, String> {
    let answer = answers
        .get("selection")
        .ok_or_else(|| "Jev response missing selection".to_string())?;
    let Answer::Choice {
        choice,
        probabilities,
        confidence,
    } = answer
    else {
        return Err("Jev selection answer must be a choice".into());
    };
    if !confidence.is_finite() || !(0.0..=1.0).contains(confidence) {
        return Err("Jev selection confidence is invalid".into());
    }
    if choice != COMPUTER_PLAN_NO_MATCH
        && !candidates.iter().any(|candidate| candidate.id == *choice)
    {
        return Err("Jev selected an unknown candidate id".into());
    }
    if probabilities.len() != candidates.len() + 1
        || !probabilities.contains_key(COMPUTER_PLAN_NO_MATCH)
        || candidates.iter().any(|candidate| !probabilities.contains_key(&candidate.id))
    {
        return Err("Jev probabilities do not match supplied candidates".into());
    }
    let total: f64 = probabilities.values().sum();
    if probabilities.values().any(|p| !p.is_finite() || !(0.0..=1.0).contains(p))
        || !total.is_finite()
        || (total - 1.0).abs() > 0.01
    {
        return Err("Jev returned an invalid probability distribution".into());
    }
    let selected_probability = probabilities[choice];
    if probabilities.values().any(|p| *p > selected_probability + 0.000001) {
        return Err("Jev choice is not the highest probability".into());
    }
    let next_probability = probabilities
        .iter()
        .filter_map(|(id, probability)| (id != choice).then_some(*probability))
        .fold(0.0, f64::max);
    if choice == COMPUTER_PLAN_NO_MATCH
        || *confidence < COMPUTER_PLAN_CONFIDENCE_MIN
        || selected_probability < 0.55
        || selected_probability - next_probability < COMPUTER_PLAN_AMBIGUITY_MARGIN
    {
        return Ok(None);
    }
    Ok(Some(choice.clone()))
}
fn process_turn(raw: String, args: &Args) -> Result<(), String> {
    let configured = profile::load();
    let raw = profile::rewrite_vocabulary(&raw, &configured);
    let detected_wake = audio::wake_matched(&raw);
    let current = audio::strip_wake_word(&raw);
    let transcript = combine_followup(&current, args.prefix.as_deref(), detected_wake);
    let wake_matched = detected_wake || args.prefix.is_some() || args.addressed;
    println!("TRANSCRIPT: {transcript}");
    if wake_matched {
        println!("WAKE");
    }
    println!(
        "STAGE transcript_ready chars={} wake_matched={wake_matched}",
        transcript.chars().count()
    );
    if env::var_os("TIBO_INTENT_CLAUDE").is_some() {
        eprintln!("TIBO_INTENT claude resolver removed; using jev");
    }
    let mut current_session = if args.smoke {
        session::Session::default()
    } else {
        session::load()
    };
    let now = memory::Now::get();
    let recent = if args.smoke {
        Vec::new()
    } else {
        memory::maybe_consolidate(now);
        memory::recent_turns(now)
    };
    let turn = Turn {
        transcript,
        wake_matched,
        asr_language: args
            .language
            .clone()
            .or_else(|| env::var("TIBO_WHISPER_LANGUAGE").ok())
            .unwrap_or_else(|| "vi".into()),
        interrupted: args.interrupted,
        conversation: args.conversation,
        session: current_session.snapshot(),
        recent: recent.iter().map(memory::format_turn).collect(),
    };
    println!("STAGE intent_start_ms={}", audio::elapsed_ms());
    let mut decision = if args.no_jev {
        policy::decide_fallback(&turn)
    } else {
        match JevClient::from_env().and_then(|client| {
            client.system_one(&questions::build_state(&turn), &questions::questions())
        }) {
            Ok(answers) => policy::decide(&turn, &answers, &Thresholds::default()),
            Err(error) => {
                // Stderr: the app forwards TIBO_ROUTE lines to its log; the turn itself goes on.
                eprintln!("TIBO_ROUTE fallback reason={error:?}");
                policy::decide_fallback(&turn)
            }
        }
    };
    println!("STAGE intent_done_ms={}", audio::elapsed_ms());
    let unsupported_computer_use = matches!(decision, policy::Decision::UnsupportedComputerUse);
    let mut workflow = if args.emit_text && turn.session.pending_confirmation.is_none() && workflow_may_override(&decision) {
        let all = workflow::load();
        workflow::find(&all, &turn.transcript).filter(|w| w.confirm || w.id == "trinh-duyet" || !unsupported_computer_use).cloned()
    } else {
        None
    };
    let mut prompt = turn.transcript.clone();
    // Acting workflows (browser automation) wait for approval like any other computer use.
    if let Some(acting) = workflow.take_if(|w| w.confirm || w.id == "trinh-duyet") {
        decision = policy::Decision::NeedConfirm {
            say: format!("Cần phê duyệt: {} theo yêu cầu này. Nói 'xác nhận' hoặc 'huỷ'.", acting.name.to_lowercase()),
            pending: policy::PendingAction::Workflow { id: acting.id, prompt: turn.transcript.clone() },
        };
    }
    if let (true, policy::Decision::Session(policy::SessionAction::Confirm)) = (args.emit_text, &decision) {
        if let Some(policy::PendingAction::Workflow { id, prompt: asked }) =
            current_session.pending_confirmation.as_ref().map(|pending| pending.action.clone())
        {
            current_session.pending_confirmation = None;
            let _ = session::save(&current_session);
            workflow = workflow::load().into_iter().find(|w| w.id == id);
            prompt = asked;
        }
    }
    if let Some(workflow) = &workflow {
        println!("STAGE workflow={}", workflow.id);
    }
    if args.emit_text && (workflow.is_some() || matches!(decision, policy::Decision::Chat)) {
        let payload = serde_json::json!({
            "prompt": prompt,
            "context": memory::context(&recent),
            "workflow": workflow.map(|w| serde_json::json!({ "id": w.id, "instructions": workflow::instructions(&w, now) })),
        });
        println!("TIBO_LLM_REQUEST {payload}");
        return io::stdout().flush().map_err(|e| e.to_string());
    }
    if let (true, policy::Decision::ReadScreen { vision }) = (args.emit_text, &decision) {
        let payload = serde_json::json!({
            "question": turn.transcript,
            "vision": vision,
            "context": memory::context(&recent),
        });
        println!("TIBO_SCREEN_REQUEST {payload}");
        return io::stdout().flush().map_err(|e| e.to_string());
    }
    let route = memory_route(&decision);
    // The app's chat session carries the memory block from its start; tell it to reload.
    if args.emit_text && matches!(decision, policy::Decision::Memory(_) | policy::Decision::Session(policy::SessionAction::Confirm)) {
        println!("TIBO_MEMORY_CHANGED");
    }
    let say = handlers::handle(decision, &mut current_session);
    if let (Some(route), Some(text), false) = (route, say.as_deref(), args.smoke) {
        memory::log_turn(&turn.transcript, text, route);
    }
    if let Some(text) = say.filter(|text| !text.is_empty()) {
        if args.emit_text {
            write_event("TIBO_SAY", &text)?;
        } else if args.speak {
            tts::output(&text, args.emit_wav)?;
        }
    }
    Ok(())
}

fn combine_followup(current: &str, prefix: Option<&str>, detected_wake: bool) -> String {
    match prefix {
        Some(prefix) if !detected_wake && !prefix.trim().is_empty() => {
            format!("{} {}", prefix.trim(), current.trim()).trim().into()
        }
        _ => current.into(),
    }
}

/// A workflow trigger beats a guessed route; acting workflows still require approval.
/// Unsupported computer use may only become a workflow that asks for approval.
fn workflow_may_override(decision: &policy::Decision) -> bool {
    use policy::{Decision as D, PendingAction as P};
    matches!(
        decision,
        D::Chat
            | D::Clarify { .. }
            | D::UnsupportedComputerUse
            | D::Closed { .. }
            | D::OpenApp { .. }
            | D::ReadScreen { .. }
            | D::NeedConfirm { pending: P::Closed { .. }, .. }
    )
}

/// Turns the backend logs itself. Chat and screen answers are streamed by the app's agent, so the
/// app logs those (`--log-turn`); ignored/incomplete/clarify turns carry nothing worth remembering.
fn memory_route(decision: &policy::Decision) -> Option<&'static str> {
    use policy::{Decision as D, PendingAction as P};
    Some(match decision {
        D::Closed { .. } => "closed_command",
        D::Session(_) => "session_control",
        D::Memory(_) => "memory",
        D::OpenApp { .. } => "computer_use",
        D::NeedConfirm { pending, .. } => match pending {
            P::Closed { .. } => "closed_command",
            P::Coding { .. } => "coding_task",
            P::Workflow { .. } => "computer_use",
            P::ForgetMemory { .. } => "memory",
        },
        D::Ignore { .. } | D::Incomplete | D::Clarify { .. } | D::UnsupportedComputerUse | D::Chat | D::ReadScreen { .. } => {
            return None
        }
    })
}

fn write_event(prefix: &str, text: &str) -> Result<(), String> {
    let stdout = io::stdout();
    let mut out = stdout.lock();
    writeln!(
        out,
        "{prefix} {}",
        serde_json::to_string(text).map_err(|e| e.to_string())?
    )
    .map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())
}

fn route_test() -> Result<(), String> {
    let client = JevClient::from_env().map_err(|e| e.to_string())?;
    for text in [
        "Tibo cho xem các agent OMP",
        "Tibo nhờ Claude review thay đổi hiện tại",
        "Tibo chạy benchmark",
        "Tibo chạy đánh giá Eva",
        "Tibo xoá hết session",
    ] {
        let turn = Turn {
            transcript: audio::strip_wake_word(text),
            wake_matched: true,
            asr_language: "vi".into(),
            interrupted: false,
            conversation: false,
            session: Default::default(),
            recent: Vec::new(),
        };
        let answers = client
            .system_one(&questions::build_state(&turn), &questions::questions())
            .map_err(|e| e.to_string())?;
        println!(
            "ROUTE_TEST {text:?} => {:?}",
            policy::decide(&turn, &answers, &Thresholds::default())
        );
    }
    Ok(())
}

fn doctor() -> Result<(), String> {
    let mut failures = Vec::new();
    for (name, path) in [
        (
            "ffmpeg",
            env_path("TIBO_FFMPEG", "/opt/homebrew/bin/ffmpeg"),
        ),
        (
            "whisper-cli",
            env_path("TIBO_WHISPER_CLI", "/opt/homebrew/bin/whisper-cli"),
        ),
        ("afplay", env_path("TIBO_AFPLAY", "/usr/bin/afplay")),
    ] {
        if !PathBuf::from(path).is_file() {
            failures.push(name.to_string());
        }
    }
    let configured = profile::load();
    let model = env::var("TIBO_WHISPER_MODEL")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home().join(".local/share/tibo/models").join(configured.whisper_model));
    if !model.is_file() {
        failures.push("whisper model".into());
    }
    let asr_model_dir = env::var("TIBO_VIETASR_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home().join(".local/share/tibo/models/vietasr"));
    for file in [
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "joiner.int8.onnx",
        "tokens.txt",
        "bpe.vocab",
        "hotwords.txt",
    ] {
        if !asr_model_dir.join(file).is_file() {
            failures.push(format!("VietASR {file}"));
        }
    }
    let asr_python = env::var("TIBO_VIETASR_PYTHON").unwrap_or_else(|_| {
        home()
            .join(".local/share/tibo/asr-venv/bin/python")
            .display()
            .to_string()
    });
    let asr_imports = Command::new(asr_python)
        .args(["-c", "import numpy, sherpa_onnx"])
        .status();
    if !asr_imports.is_ok_and(|status| status.success()) {
        failures.push("VietASR Python imports".into());
    }
    let model_dir = env::var("TIBO_TTS_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home().join(".local/share/tibo/models/kokoro-vi"));
    for file in ["config.json", "kokoro_vi.onnx", "voices.json"] {
        if !model_dir.join(file).is_file() {
            failures.push(format!("TTS {file}"));
        }
    }
    let python = env::var("TIBO_TTS_PYTHON").unwrap_or_else(|_| {
        home()
            .join(".local/share/tibo/tts-venv/bin/python")
            .display()
            .to_string()
    });
    let imports = Command::new(python)
        .args(["-c", "import onnxruntime, vig2p"])
        .status();
    if !imports.is_ok_and(|status| status.success()) {
        failures.push("TTS Python imports".into());
    }
    if failures.is_empty() {
        println!("DOCTOR PASS");
        Ok(())
    } else {
        for failure in failures {
            println!("DOCTOR FAIL {failure}");
        }
        Err("doctor checks failed".into())
    }
}

fn legacy_eval(args: &Args) -> Result<(), String> {
    let script = env::temp_dir().join(format!("tibo-eva-{}.py", std::process::id()));
    fs::write(&script, include_str!("../../scripts/eva_adapter.py")).map_err(|e| e.to_string())?;
    let python = env::var("TIBO_EVA_PYTHON").unwrap_or_else(|_| "python3".into());
    let root =
        env::var("TIBO_EVA_ROOT").unwrap_or_else(|_| home().join("eva").display().to_string());
    let mut command = Command::new(python);
    command.arg(script).args(["--eva-root", &root]);
    if args.eval_run {
        command.args(["--mode", "run"]);
        if args.approve_run {
            command.arg("--approve-run");
        }
        command.args([
            "--run-id",
            args.eval_run_id
                .as_deref()
                .ok_or("--eval-run requires --eval-run-id")?,
        ]);
    }
    let status = command.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Eva exited with {status}"))
    }
}

fn parse_args() -> Result<Args, String> {
    parse_args_from(env::args().skip(1))
}

fn parse_args_from(args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut parsed = Args {
        record_seconds: 8,
        speak: true,
        ..Default::default()
    };
    let mut args = args;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--voice" => parsed.voice = true,
            "--text" => parsed.text = Some(next(&mut args, "--text")?),
            "--audio" => parsed.audio = Some(PathBuf::from(next(&mut args, "--audio")?)),
            "--model" => parsed.model = Some(PathBuf::from(next(&mut args, "--model")?)),
            "--record-seconds" => {
                parsed.record_seconds = next(&mut args, "--record-seconds")?
                    .parse()
                    .map_err(|_| "invalid --record-seconds")?
            }
            "--speak" => parsed.speak = true,
            "--no-say" => parsed.speak = false,
            "--emit-wav" => {
                parsed.emit_wav = true;
                parsed.speak = true;
            }
            "--emit-text" => parsed.emit_text = true,
            "--tts-server" => parsed.tts_server = true,
            "--computer-plan" => parsed.computer_plan = true,
            "--transcribe" => parsed.transcribe = Some(PathBuf::from(next(&mut args, "--transcribe")?)),
            "--say" => parsed.say = Some(next(&mut args, "--say")?),
            "--doctor" => parsed.doctor = true,
            "--smoke" => parsed.smoke = true,
            "--route-test" => parsed.route_test = true,
            "--no-jev" => parsed.no_jev = true,
            "--interrupted" => parsed.interrupted = true,
            "--addressed" => parsed.addressed = true,
            "--conversation" => parsed.conversation = true,
            "--prefix-transcript" => parsed.prefix = Some(next(&mut args, "--prefix-transcript")?),
            "--language" => parsed.language = Some(next(&mut args, "--language")?),
            "--prompt" => parsed.prompt = Some(next(&mut args, "--prompt")?),
            "--eval" => parsed.eval = true,
            "--eval-run" => parsed.eval_run = true,
            "--approve-run" => parsed.approve_run = true,
            "--eval-run-id" => parsed.eval_run_id = Some(next(&mut args, "--eval-run-id")?),
            "--log-turn" => parsed.log_turn = Some(next(&mut args, "--log-turn")?),
            "--consolidate-memory" => {
                parsed.consolidate_memory = Some(next(&mut args, "--consolidate-memory")?)
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(parsed)
}

fn next(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{flag} requires a value"))
}
fn env_path(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.into())
}
fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_wake_starts_a_fresh_turn_after_incomplete_speech() {
        assert_eq!(combine_followup("ngày mai có mưa không?", Some("mở Safari"), true), "ngày mai có mưa không?");
        assert_eq!(combine_followup("trên Safari", Some("mở trang"), false), "mở trang trên Safari");
    }

    fn candidate(id: &str) -> ComputerPlanCandidate {
        ComputerPlanCandidate {
            id: id.into(),
            title: "Safari".into(),
            detail: "Browser window".into(),
        }
    }

    #[test]
    fn computer_plan_rejects_invalid_or_uncertain_choices() {
        let candidates = vec![candidate("c0"), candidate("c1")];
        assert!(validate_computer_plan_request(&ComputerPlanRequest {
            query: "open browser".into(),
            candidates: vec![candidate("c0"), candidate("c0")],
        })
        .is_err());

        let probabilities = std::collections::HashMap::from([
            ("c0".into(), 0.82),
            ("c1".into(), 0.08),
            (COMPUTER_PLAN_NO_MATCH.into(), 0.10),
        ]);
        let mut answers = Answers::new();
        answers.insert(
            "selection".into(),
            Answer::Choice {
                choice: "c0".into(),
                probabilities: probabilities.clone(),
                confidence: 0.59,
            },
        );
        assert_eq!(select_computer_plan_candidate(&answers, &candidates).unwrap(), None);

        answers.insert(
            "selection".into(),
            Answer::Choice {
                choice: "c0".into(),
                probabilities: probabilities.clone(),
                confidence: 0.9,
            },
        );
        assert_eq!(select_computer_plan_candidate(&answers, &candidates).unwrap(), Some("c0".into()));

        answers.insert(
            "selection".into(),
            Answer::Choice {
                choice: "c0".into(),
                probabilities: Default::default(),
                confidence: 0.9,
            },
        );
        assert!(select_computer_plan_candidate(&answers, &candidates).is_err());

        answers.insert(
            "selection".into(),
            Answer::Choice {
                choice: "not-supplied".into(),
                probabilities,
                confidence: 0.99,
            },
        );
        assert!(select_computer_plan_candidate(&answers, &candidates).is_err());
    }
}

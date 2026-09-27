use tibo::{
    audio, handlers,
    jev::JevClient,
    policy,
    profile,
    questions::{self, Thresholds, Turn},
    session, tts,
};
use std::{
    env, fs,
    io::{self, Write},
    path::PathBuf,
    process::{Command, ExitCode},
};

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
    prefix: Option<String>,
    language: Option<String>,
    prompt: Option<String>,
    eval: bool,
    eval_run: bool,
    approve_run: bool,
    eval_run_id: Option<String>,
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
    if args.tts_server {
        return tts::serve();
    }
    if args.doctor {
        return doctor();
    }
    if args.eval || args.eval_run {
        return legacy_eval(&args);
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
            "use --voice, --text, --transcribe, --say, --tts-server, --doctor, --smoke, --route-test, or --eval"
                .into(),
        );
    };
    process_turn(transcript, &args)
}

fn process_turn(raw: String, args: &Args) -> Result<(), String> {
    let configured = profile::load();
    let raw = profile::rewrite_vocabulary(&raw, &configured);
    let detected_wake = audio::wake_matched(&raw);
    let current = audio::strip_wake_word(&raw);
    let transcript = match args.prefix.as_deref() {
        Some(prefix) if !prefix.trim().is_empty() => {
            format!("{} {}", prefix.trim(), current.trim())
                .trim()
                .into()
        }
        _ => current,
    };
    let wake_matched = detected_wake || args.prefix.is_some();
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
    let turn = Turn {
        transcript,
        wake_matched,
        asr_language: args
            .language
            .clone()
            .or_else(|| env::var("TIBO_WHISPER_LANGUAGE").ok())
            .unwrap_or_else(|| "vi".into()),
        interrupted: args.interrupted,
        session: current_session.snapshot(),
    };
    println!("STAGE intent_start_ms={}", audio::elapsed_ms());
    let decision = if args.no_jev {
        policy::decide_fallback(&turn)
    } else {
        match JevClient::from_env().and_then(|client| {
            client.system_one(&questions::build_state(&turn), &questions::questions())
        }) {
            Ok(answers) => policy::decide(&turn, &answers, &Thresholds::default()),
            Err(_) => policy::decide_fallback(&turn),
        }
    };
    println!("STAGE intent_done_ms={}", audio::elapsed_ms());
    if args.emit_text && matches!(decision, policy::Decision::Chat) {
        return write_event("TIBO_LLM_REQUEST", &turn.transcript);
    }
    let say = handlers::handle(decision, &mut current_session);
    if let Some(text) = say.filter(|text| !text.is_empty()) {
        if args.emit_text {
            write_event("TIBO_SAY", &text)?;
        } else if args.speak {
            tts::output(&text, args.emit_wav)?;
        }
    }
    Ok(())
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
            session: Default::default(),
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
    let mut parsed = Args {
        record_seconds: 8,
        speak: true,
        ..Default::default()
    };
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--voice" => parsed.voice = true,
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
            "--text" => parsed.text = Some(next(&mut args, "--text")?),
            "--transcribe" => parsed.transcribe = Some(PathBuf::from(next(&mut args, "--transcribe")?)),
            "--say" => parsed.say = Some(next(&mut args, "--say")?),
            "--doctor" => parsed.doctor = true,
            "--smoke" => parsed.smoke = true,
            "--route-test" => parsed.route_test = true,
            "--no-jev" => parsed.no_jev = true,
            "--interrupted" => parsed.interrupted = true,
            "--prefix-transcript" => parsed.prefix = Some(next(&mut args, "--prefix-transcript")?),
            "--language" => parsed.language = Some(next(&mut args, "--language")?),
            "--prompt" => parsed.prompt = Some(next(&mut args, "--prompt")?),
            "--eval" => parsed.eval = true,
            "--eval-run" => parsed.eval_run = true,
            "--approve-run" => parsed.approve_run = true,
            "--eval-run-id" => parsed.eval_run_id = Some(next(&mut args, "--eval-run-id")?),
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

use tibo::{audio, profile, tts};
use std::{
    env,
    path::PathBuf,
    process::{Command, ExitCode},
};

enum Action {
    Doctor,
    Transcribe(PathBuf),
    TtsServer,
    Say(String),
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
    match parse_args()? {
        Action::Doctor => doctor(),
        Action::Transcribe(wav) => {
            audio::validate_wav(&wav)?;
            println!("{}", audio::transcribe(&wav, None, None, None)?);
            Ok(())
        }
        Action::TtsServer => tts::serve(),
        Action::Say(text) => tts::output(&text, false),
    }
}

fn doctor() -> Result<(), String> {
    let mut failures = Vec::new();
    for (name, path) in [
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

fn parse_args() -> Result<Action, String> {
    parse_args_from(env::args().skip(1))
}

fn parse_args_from(mut args: impl Iterator<Item = String>) -> Result<Action, String> {
    let mut action = None;
    while let Some(arg) = args.next() {
        action = Some(match arg.as_str() {
            "--doctor" => Action::Doctor,
            "--transcribe" => Action::Transcribe(PathBuf::from(next(&mut args, "--transcribe")?)),
            "--tts-server" => Action::TtsServer,
            "--say" => Action::Say(next(&mut args, "--say")?),
            other => return Err(format!("unknown argument: {other}")),
        });
    }
    action.ok_or_else(|| "use --doctor, --transcribe <wav>, --tts-server, or --say <text>".into())
}

fn next(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next().ok_or_else(|| format!("{flag} requires a value"))
}

fn env_path(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.into())
}

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

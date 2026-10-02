use crate::profile;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::LazyLock,
    time::{Duration, Instant},
};

static STARTED: LazyLock<Instant> = LazyLock::new(Instant::now);
const VIETASR_BRIDGE: &str = include_str!("../scripts/vietasr_bridge.py");

pub fn elapsed_ms() -> u128 {
    STARTED.elapsed().as_millis()
}


pub fn transcribe(
    wav: &Path,
    model: Option<&Path>,
    language: Option<&str>,
    prompt: Option<&str>,
) -> Result<String, String> {
    let configured = profile::load();
    let backend = env::var("TIBO_ASR_BACKEND").unwrap_or_else(|_| configured.stt_engine.clone());
    if model.is_some() || backend == "whisper" || backend == "apple" {
        return transcribe_whisper(wav, model, language, prompt, &configured);
    }
    if backend != "vietasr" {
        return Err(format!("unsupported ASR backend: {backend}"));
    }
    match transcribe_vietasr(wav) {
        Ok(text) if !text.is_empty() => Ok(text),
        Ok(_) => {
            eprintln!("TIBO_STT vietasr returned empty transcript; falling back to whisper");
            transcribe_whisper(wav, None, language, prompt, &configured)
        }
        Err(error) => {
            eprintln!("TIBO_STT vietasr failed: {error}; falling back to whisper");
            transcribe_whisper(wav, None, language, prompt, &configured)
        }
    }
}

fn transcribe_vietasr(wav: &Path) -> Result<String, String> {
    let python = env::var("TIBO_VIETASR_PYTHON").unwrap_or_else(|_| {
        home()
            .join(".local/share/tibo/asr-venv/bin/python")
            .display()
            .to_string()
    });
    let model_dir = env::var("TIBO_VIETASR_MODEL_DIR").unwrap_or_else(|_| {
        home()
            .join(".local/share/tibo/models/vietasr")
            .display()
            .to_string()
    });
    let threads = env::var("TIBO_VIETASR_THREADS").unwrap_or_else(|_| "4".into());
    let script = env::temp_dir().join(format!("tibo-vietasr-{}.py", std::process::id()));
    fs::write(&script, VIETASR_BRIDGE).map_err(|e| e.to_string())?;
    eprintln!("STAGE vietasr_start_ms={}", elapsed_ms());
    eprintln!("TIBO_STT backend=vietasr model=int8");
    let output = Command::new(python)
        .arg(&script)
        .args(["--model-dir", &model_dir, "--threads", &threads])
        .arg(wav)
        .output()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(script);
    eprintln!("STAGE vietasr_done_ms={}", elapsed_ms());
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn transcribe_whisper(
    wav: &Path,
    model: Option<&Path>,
    language: Option<&str>,
    prompt: Option<&str>,
    configured: &profile::Profile,
) -> Result<String, String> {
    let explicit_model = model.is_some();
    let whisper =
        env::var("TIBO_WHISPER_CLI").unwrap_or_else(|_| "/opt/homebrew/bin/whisper-cli".into());
    let model = model
        .map(Path::to_path_buf)
        .or_else(|| env::var_os("TIBO_WHISPER_MODEL").map(PathBuf::from))
        .unwrap_or_else(|| home().join(".local/share/tibo/models").join(&configured.whisper_model));
    let language = language
        .map(str::to_owned)
        .or_else(|| env::var("TIBO_WHISPER_LANGUAGE").ok())
        .unwrap_or_else(|| "vi".into());
    let assistant = if configured.assistant_name.trim().is_empty() {
        "Tibo"
    } else {
        configured.assistant_name.as_str()
    };
    let vocabulary = configured
        .vocabulary
        .iter()
        .map(|term| term.word.trim())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    let default_prompt = format!(
        "{assistant} ơi, hãy nghe rõ câu nói.{vocabulary_suffix}",
        vocabulary_suffix = if vocabulary.is_empty() {
            String::new()
        } else {
            format!(" Từ vựng: {vocabulary}.")
        }
    );
    let prompt = prompt
        .map(str::to_owned)
        .or_else(|| env::var("TIBO_WHISPER_PROMPT").ok())
        .unwrap_or(default_prompt);
    eprintln!("STAGE whisper_start_ms={}", elapsed_ms());
    // The app runs a resident whisper-server (same model); an explicit --model means "use this file".
    if let (Ok(url), false) = (env::var("TIBO_WHISPER_URL"), explicit_model) {
        match transcribe_whisper_server(&url, wav, &language, &prompt) {
            Ok(text) => {
                eprintln!("TIBO_STT backend=whisper-server language={language}");
                eprintln!("STAGE whisper_done_ms={}", elapsed_ms());
                return Ok(text);
            }
            Err(error) => eprintln!("TIBO_STT whisper-server failed: {error}; using whisper-cli"),
        }
    }
    let mut command = Command::new(whisper);
    command
        .args(["-np", "-nt", "-l", &language, "-m"])
        .arg(&model);
    command.args(["--prompt", &prompt, "--carry-initial-prompt"]);
    eprintln!(
        "TIBO_STT backend=whisper model={} language={language}",
        model
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("custom")
    );
    let output = command
        .arg("-f")
        .arg(wav)
        .output()
        .map_err(|e| e.to_string())?;
    eprintln!("STAGE whisper_done_ms={}", elapsed_ms());
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn transcribe_whisper_server(url: &str, wav: &Path, language: &str, prompt: &str) -> Result<String, String> {
    let audio = fs::read(wav).map_err(|e| e.to_string())?;
    let boundary = "tibo-7c1f4e2a9b";
    let mut body = Vec::with_capacity(audio.len() + 1024);
    for (name, value) in [("language", language), ("prompt", prompt), ("response_format", "text")] {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(&audio);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let http: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into();
    let text = http
        .post(url)
        .header("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .send(&body[..])
        .map_err(|e| e.to_string())?
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}


fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

pub fn temp_wav(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    env::temp_dir().join(format!("tibo-{label}-{}-{nanos}.wav", std::process::id()))
}

pub fn validate_wav(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() < 44 {
        Err("audio file is not a valid WAV".into())
    } else {
        Ok(())
    }
}



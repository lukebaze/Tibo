use crate::policy::normalize;
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

pub fn capture(seconds: u64, device: Option<&str>) -> Result<PathBuf, String> {
    let wav = temp_wav("input");
    let ffmpeg = env::var("TIBO_FFMPEG").unwrap_or_else(|_| "/opt/homebrew/bin/ffmpeg".into());
    let device = device
        .map(str::to_owned)
        .or_else(|| env::var("TIBO_AUDIO_DEVICE").ok())
        .unwrap_or_else(|| "0".into());
    let status = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "avfoundation",
            "-i",
            &format!(":{device}"),
            "-t",
            &seconds.to_string(),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-y",
        ])
        .arg(&wav)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(wav)
    } else {
        Err(format!("ffmpeg exited with {status}"))
    }
}

pub fn transcribe(
    wav: &Path,
    model: Option<&Path>,
    language: Option<&str>,
    prompt: Option<&str>,
) -> Result<String, String> {
    let backend = env::var("TIBO_ASR_BACKEND").unwrap_or_else(|_| "whisper".into());
    if model.is_some() || backend == "whisper" {
        return transcribe_whisper(wav, model, language, prompt);
    }
    if backend != "vietasr" {
        return Err(format!("unsupported ASR backend: {backend}"));
    }
    match transcribe_vietasr(wav) {
        Ok(text) if !text.is_empty() => Ok(text),
        Ok(_) => {
            eprintln!("TIBO_STT vietasr returned empty transcript; falling back to whisper");
            transcribe_whisper(wav, None, language, prompt)
        }
        Err(error) => {
            eprintln!("TIBO_STT vietasr failed: {error}; falling back to whisper");
            transcribe_whisper(wav, None, language, prompt)
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
    println!("STAGE vietasr_start_ms={}", elapsed_ms());
    eprintln!("TIBO_STT backend=vietasr model=int8");
    let output = Command::new(python)
        .arg(&script)
        .args(["--model-dir", &model_dir, "--threads", &threads])
        .arg(wav)
        .output()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(script);
    println!("STAGE vietasr_done_ms={}", elapsed_ms());
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
) -> Result<String, String> {
    let explicit_model = model.is_some();
    let whisper =
        env::var("TIBO_WHISPER_CLI").unwrap_or_else(|_| "/opt/homebrew/bin/whisper-cli".into());
    let model = model
        .map(Path::to_path_buf)
        .or_else(|| env::var_os("TIBO_WHISPER_MODEL").map(PathBuf::from))
        .unwrap_or_else(|| home().join(".local/share/tibo/models/ggml-large-v3-turbo-q5_0.bin"));
    let language = language
        .map(str::to_owned)
        .or_else(|| env::var("TIBO_WHISPER_LANGUAGE").ok())
        .unwrap_or_else(|| "vi".into());
    let prompt = prompt.map(str::to_owned).or_else(|| env::var("TIBO_WHISPER_PROMPT").ok()).unwrap_or_else(|| "Tibo ơi, liệt kê các agent OMP. Tibo, nhờ Claude Code review thay đổi. Chạy Codex, chạy benchmark, đánh giá Eva. Dừng lại, tiếp tục, xác nhận, huỷ.".into());
    println!("STAGE whisper_start_ms={}", elapsed_ms());
    // The app runs a resident whisper-server (same model); an explicit --model means "use this file".
    if let (Ok(url), false) = (env::var("TIBO_WHISPER_URL"), explicit_model) {
        match transcribe_whisper_server(&url, wav, &language, &prompt) {
            Ok(text) => {
                eprintln!("TIBO_STT backend=whisper-server language={language}");
                println!("STAGE whisper_done_ms={}", elapsed_ms());
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
    println!("STAGE whisper_done_ms={}", elapsed_ms());
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
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .into();
    let text = agent
        .post(url)
        .header("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .send(&body[..])
        .map_err(|e| e.to_string())?
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}

/// Whisper hears the name as "Tibo", "Tibor", "Ti bo", "Tì bò", often with trailing
/// punctuation. Returns how many leading (normalized) words spell it.
fn wake_len(words: &[&str]) -> usize {
    let bare = |word: &str| word.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
    match words {
        [one, ..] if bare(one).starts_with("tibo") => 1,
        [ti, bo, ..] if bare(ti) == "ti" && bare(bo) == "bo" => 2,
        _ => 0,
    }
}

pub fn wake_matched(transcript: &str) -> bool {
    let text = normalize(transcript);
    let words: Vec<&str> = text.split_whitespace().collect();
    (0..words.len()).any(|start| wake_len(&words[start..]) > 0)
}

pub fn strip_wake_word(transcript: &str) -> String {
    let normalized = normalize(transcript);
    let count = wake_len(&normalized.split_whitespace().collect::<Vec<_>>());
    transcript.split_whitespace().skip(count).collect::<Vec<_>>().join(" ")
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

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_spellings_of_tibo_wake_and_strip() {
        // Observed Whisper large-v3-turbo outputs for spoken "Tibo".
        for (raw, rest) in [
            ("Ti bo ơi, liệt kê các agent đang chạy.", "ơi, liệt kê các agent đang chạy."),
            ("Tibo, chạy benchmark tiếng Việt.", "chạy benchmark tiếng Việt."),
            ("Tibor nhớ Cloud review thay đổi.", "nhớ Cloud review thay đổi."),
            ("Tì bò ơi", "ơi"),
        ] {
            assert!(wake_matched(raw), "{raw}");
            assert_eq!(strip_wake_word(raw), rest);
        }
        assert!(wake_matched("Này Ti Bo, dừng lại!"));
        assert_eq!(strip_wake_word("Này Ti Bo, dừng lại!"), "Này Ti Bo, dừng lại!");
        assert!(!wake_matched("Dừng lại, tiếp tục."));
        assert_eq!(strip_wake_word("Dừng lại."), "Dừng lại.");
    }
}

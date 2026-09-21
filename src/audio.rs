use crate::policy::normalize;
use std::{env, fs, path::{Path, PathBuf}, process::Command, sync::LazyLock, time::Instant};

static STARTED: LazyLock<Instant> = LazyLock::new(Instant::now);

pub fn elapsed_ms() -> u128 {
    STARTED.elapsed().as_millis()
}

pub fn capture(seconds: u64, device: Option<&str>) -> Result<PathBuf, String> {
    let wav = temp_wav("input");
    let ffmpeg = env::var("GRAVIZ_FFMPEG").unwrap_or_else(|_| "/opt/homebrew/bin/ffmpeg".into());
    let device = device.map(str::to_owned).or_else(|| env::var("GRAVIZ_AUDIO_DEVICE").ok()).unwrap_or_else(|| "0".into());
    let status = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", &format!(":{device}"), "-t", &seconds.to_string(), "-ar", "16000", "-ac", "1", "-y"])
        .arg(&wav)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() { Ok(wav) } else { Err(format!("ffmpeg exited with {status}")) }
}

pub fn transcribe(wav: &Path, model: Option<&Path>, language: Option<&str>, prompt: Option<&str>) -> Result<String, String> {
    let whisper = env::var("GRAVIZ_WHISPER_CLI").unwrap_or_else(|_| "/opt/homebrew/bin/whisper-cli".into());
    let model = model.map(Path::to_path_buf)
        .or_else(|| env::var_os("GRAVIZ_WHISPER_MODEL").map(PathBuf::from))
        .unwrap_or_else(|| home().join(".local/share/graviz/models/ggml-small.bin"));
    let language = language.map(str::to_owned).or_else(|| env::var("GRAVIZ_WHISPER_LANGUAGE").ok()).unwrap_or_else(|| "vi".into());
    let prompt = prompt.map(str::to_owned).or_else(|| env::var("GRAVIZ_WHISPER_PROMPT").ok()).unwrap_or_else(|| "Graviz. Trợ lý giọng nói tiếng Việt. OMP, Claude Code, Codex, Eva. Lệnh: dừng, tiếp tục, xác nhận, huỷ, liệt kê agent, review thay đổi, chạy benchmark.".into());
    println!("STAGE whisper_start_ms={}", elapsed_ms());
    let mut command = Command::new(whisper);
    command.args(["-np", "-nt", "-l", &language, "-m"]).arg(&model);
    command.args(["--prompt", &prompt, "--carry-initial-prompt"]);
    eprintln!("GRAVIZ_STT model={} language={language}", model.file_name().and_then(|name| name.to_str()).unwrap_or("custom"));
    let output = command.arg("-f").arg(wav).output().map_err(|e| e.to_string())?;
    println!("STAGE whisper_done_ms={}", elapsed_ms());
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn wake_matched(transcript: &str) -> bool {
    let text = normalize(transcript);
    ["graviz", "gra viz", "gravis", "go ra vit", "ra vit"].iter().any(|wake| text.contains(wake))
}

pub fn strip_wake_word(transcript: &str) -> String {
    let words: Vec<&str> = transcript.split_whitespace().collect();
    let normalized = normalize(transcript);
    let count = if normalized.starts_with("go ra vit ") { 3 }
        else if normalized.starts_with("gra viz ") || normalized.starts_with("ra vit ") { 2 }
        else if normalized == "go ra vit" { 3 }
        else if normalized == "gra viz" || normalized == "ra vit" { 2 }
        else if normalized.starts_with("graviz ") || normalized.starts_with("gravis ") { 1 }
        else if normalized == "graviz" || normalized == "gravis" { 1 }
        else { 0 };
    words.into_iter().skip(count).collect::<Vec<_>>().join(" ")
}

pub fn temp_wav(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    env::temp_dir().join(format!("graviz-{label}-{}-{nanos}.wav", std::process::id()))
}

pub fn validate_wav(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() < 44 { Err("audio file is not a valid WAV".into()) } else { Ok(()) }
}

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

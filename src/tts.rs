use crate::audio::{elapsed_ms, temp_wav};
use std::{env, fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::mpsc::{self, Receiver}, thread, time::Duration};

const BRIDGE: &str = include_str!("../scripts/kokoro_vi_bridge.py");

pub struct TtsEngine {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl TtsEngine {
    pub fn start() -> Result<Self, String> {
        let script = env::temp_dir().join(format!("graviz-kokoro-{}.py", std::process::id()));
        fs::write(&script, BRIDGE).map_err(|e| e.to_string())?;
        let python = env::var("GRAVIZ_TTS_PYTHON").unwrap_or_else(|_| home().join(".local/share/graviz/tts-venv/bin/python").display().to_string());
        let model_dir = env::var("GRAVIZ_TTS_MODEL_DIR").unwrap_or_else(|_| home().join(".local/share/graviz/models/kokoro-vi").display().to_string());
        let voice = env::var("GRAVIZ_TTS_VOICE").unwrap_or_else(|_| "diem_trinh".into());
        let threads = env::var("GRAVIZ_TTS_THREADS").unwrap_or_else(|_| "0".into());
        let mut child = Command::new(python)
            .arg(script).args(["--server", "--voice", &voice, "--model-dir", &model_dir, "--speed", "1.0", "--threads", &threads])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit())
            .spawn().map_err(|e| e.to_string())?;
        let stdin = child.stdin.take().ok_or("missing TTS stdin")?;
        let stdout = child.stdout.take().ok_or("missing TTS stdout")?;
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() { break; }
            }
        });
        match lines.recv_timeout(Duration::from_secs(20)) {
            Ok(line) if line == "READY" => {
                println!("STAGE tts_init_done_ms={}", elapsed_ms());
                Ok(Self { child, stdin, lines })
            }
            Ok(line) => Err(format!("unexpected TTS response: {line}")),
            Err(_) => Err("TTS startup timed out".into()),
        }
    }

    pub fn synthesize(&mut self, text: &str) -> Result<PathBuf, String> {
        let wav = temp_wav("tts");
        writeln!(self.stdin, "{}\t{}", hex(text.as_bytes()), wav.display()).map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())?;
        match self.lines.recv_timeout(Duration::from_secs(60)) {
            Ok(line) if line == "OK" => {
                println!("STAGE tts_synthesis_done_ms={}", elapsed_ms());
                Ok(wav)
            }
            Ok(line) if line.starts_with("ERR ") => Err(decode_error(&line[4..])),
            Ok(line) => Err(format!("unexpected TTS response: {line}")),
            Err(_) => Err("TTS synthesis timed out".into()),
        }
    }
}

impl Drop for TtsEngine {
    fn drop(&mut self) { let _ = self.child.kill(); }
}

pub fn output(text: &str, emit_wav: bool) -> Result<(), String> {
    let mut engine = TtsEngine::start()?;
    let wav = engine.synthesize(text)?;
    if emit_wav {
        println!("GRAVIZ_TTS_WAV {}", wav.display());
        return Ok(());
    }
    let afplay = env::var("GRAVIZ_AFPLAY").unwrap_or_else(|_| "/usr/bin/afplay".into());
    let status = Command::new(afplay).arg(&wav).status().map_err(|e| e.to_string())?;
    if !status.success() { return Err(format!("afplay exited with {status}")); }
    println!("STAGE tts_playback_done_ms={}", elapsed_ms());
    let _ = fs::remove_file(wav);
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes { value.push(DIGITS[(byte >> 4) as usize] as char); value.push(DIGITS[(byte & 15) as usize] as char); }
    value
}

fn decode_error(value: &str) -> String {
    let bytes: Vec<u8> = value.as_bytes().chunks_exact(2).filter_map(|pair| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()).collect();
    String::from_utf8_lossy(&bytes).into()
}

fn home() -> PathBuf { PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into())) }

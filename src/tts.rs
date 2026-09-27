use crate::audio::{elapsed_ms, temp_wav};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver},
        Arc,
    },
    thread,
    time::Duration,
};

const BRIDGE: &str = include_str!("../scripts/kokoro_vi_bridge.py");

enum TtsBackend {
    Kokoro {
        child: Child,
        stdin: ChildStdin,
        lines: Receiver<String>,
    },
    System {
        voice: String,
    },
}

pub struct TtsEngine {
    backend: TtsBackend,
}

impl TtsEngine {
    pub fn start() -> Result<Self, String> {
        let profile = crate::profile::load();
        let voice = env::var("TIBO_TTS_VOICE").unwrap_or(profile.tts_voice);
        Self::start_with_engine(&voice, &env::var("TIBO_TTS_ENGINE").unwrap_or(profile.tts_engine))
    }

    pub fn start_with_voice(voice: &str) -> Result<Self, String> {
        let engine = env::var("TIBO_TTS_ENGINE")
            .unwrap_or_else(|_| crate::profile::load().tts_engine);
        Self::start_with_engine(voice, &engine)
    }

    fn start_with_engine(voice: &str, engine: &str) -> Result<Self, String> {
        if engine == "system" {
            return Ok(Self {
                backend: TtsBackend::System {
                    voice: voice.into(),
                },
            });
        }
        Self::start_kokoro(voice)
    }

    fn start_kokoro(voice: &str) -> Result<Self, String> {
        let script = env::temp_dir().join(format!("tibo-kokoro-{}.py", std::process::id()));
        fs::write(&script, BRIDGE).map_err(|e| e.to_string())?;
        let python = env::var("TIBO_TTS_PYTHON").unwrap_or_else(|_| {
            home()
                .join(".local/share/tibo/tts-venv/bin/python")
                .display()
                .to_string()
        });
        let model_dir = env::var("TIBO_TTS_MODEL_DIR").unwrap_or_else(|_| {
            home()
                .join(".local/share/tibo/models/kokoro-vi")
                .display()
                .to_string()
        });
        let threads = env::var("TIBO_TTS_THREADS").unwrap_or_else(|_| "0".into());
        let mut child = Command::new(python)
            .arg(script)
            .args([
                "--server",
                "--voice",
                voice,
                "--model-dir",
                &model_dir,
                "--speed",
                "1.0",
                "--threads",
                &threads,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| e.to_string())?;
        let stdin = child.stdin.take().ok_or("missing TTS stdin")?;
        let stdout = child.stdout.take().ok_or("missing TTS stdout")?;
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        match lines.recv_timeout(Duration::from_secs(20)) {
            Ok(line) if line == "READY" => {
                eprintln!("STAGE tts_init_done_ms={}", elapsed_ms());
                Ok(Self {
                    backend: TtsBackend::Kokoro {
                        child,
                        stdin,
                        lines,
                    },
                })
            }
            Ok(line) => Err(format!("unexpected TTS response: {line}")),
            Err(_) => Err("TTS startup timed out".into()),
        }
    }

    pub fn synthesize(&mut self, text: &str) -> Result<PathBuf, String> {
        match &mut self.backend {
            TtsBackend::System { voice } => {
                let wav = temp_wav("tts");
                let status = Command::new("/usr/bin/say")
                    .args([
                        "-v",
                        voice,
                        "-o",
                        &wav.display().to_string(),
                        "--file-format=WAVE",
                        "--data-format=LEI16@24000",
                        text,
                    ])
                    .status()
                    .map_err(|e| e.to_string())?;
                if status.success() {
                    Ok(wav)
                } else {
                    Err(format!("say exited with {status}"))
                }
            }
            TtsBackend::Kokoro { stdin, lines, .. } => {
                let wav = temp_wav("tts");
                writeln!(stdin, "{}\t{}", hex(text.as_bytes()), wav.display())
                    .map_err(|e| e.to_string())?;
                stdin.flush().map_err(|e| e.to_string())?;
                match lines.recv_timeout(Duration::from_secs(60)) {
                    Ok(line) if line == "OK" => {
                        eprintln!("STAGE tts_synthesis_done_ms={}", elapsed_ms());
                        Ok(wav)
                    }
                    Ok(line) if line.starts_with("ERR ") => Err(decode_error(&line[4..])),
                    Ok(line) => Err(format!("unexpected TTS response: {line}")),
                    Err(_) => Err("TTS synthesis timed out".into()),
                }
            }
        }
    }
}

impl Drop for TtsEngine {
    fn drop(&mut self) {
        if let TtsBackend::Kokoro { child, .. } = &mut self.backend {
            let _ = child.kill();
        }
    }
}

pub fn output(text: &str, emit_wav: bool) -> Result<(), String> {
    let mut engine = TtsEngine::start()?;
    let wav = engine.synthesize(text)?;
    if emit_wav {
        println!("TIBO_TTS_WAV {}", wav.display());
        return Ok(());
    }
    let afplay = env::var("TIBO_AFPLAY").unwrap_or_else(|_| "/usr/bin/afplay".into());
    let status = Command::new(afplay)
        .arg(&wav)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("afplay exited with {status}"));
    }
    eprintln!("STAGE tts_playback_done_ms={}", elapsed_ms());
    let _ = fs::remove_file(wav);
    Ok(())
}

#[derive(Default)]
struct SentenceBuffer {
    text: String,
}

impl SentenceBuffer {
    fn append(&mut self, delta: &str) -> Vec<String> {
        self.text.push_str(delta);
        self.drain(false)
    }

    fn finish(&mut self) -> Vec<String> {
        self.drain(true)
    }

    fn clear(&mut self) {
        self.text.clear();
    }

    fn drain(&mut self, final_delta: bool) -> Vec<String> {
        let mut chunks = Vec::new();
        loop {
            let chars: Vec<(usize, char)> = self.text.char_indices().collect();
            let end = chars
                .iter()
                .enumerate()
                .find(|&(i, &(_, c))| match c {
                    '!' | '?' | '…' | '\n' => true,
                    // "4.5" / "2.000" are numbers, not sentence ends; a trailing "4." waits for the next delta.
                    '.' => {
                        let after_digit = i > 0 && chars[i - 1].1.is_ascii_digit();
                        !after_digit || chars.get(i + 1).is_some_and(|&(_, next)| !next.is_ascii_digit())
                    }
                    _ => false,
                })
                .map(|(_, &(index, c))| index + c.len_utf8())
                .or_else(|| {
                    if self.text.chars().count() <= 160 {
                        return None;
                    }
                    self.text
                        .char_indices()
                        .scan(0usize, |count, (index, c)| {
                            *count += 1;
                            Some((index, c, *count))
                        })
                        .find(|(_, c, count)| c.is_whitespace() && *count >= 160)
                        .map(|(index, c, _)| index + c.len_utf8())
                });
            let Some(end) = end else { break };
            let chunk = self.text[..end].trim().to_string();
            self.text.drain(..end);
            if !chunk.is_empty() {
                chunks.push(chunk);
            }
        }
        if final_delta {
            let remainder = self.text.trim().to_string();
            self.text.clear();
            if !remainder.is_empty() {
                chunks.push(remainder);
            }
        }
        chunks
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Delta {
        turn_id: u64,
        text: String,
        #[serde(rename = "final")]
        final_delta: bool,
    },
    Cancel {
        turn_id: u64,
    },
}

struct Synthesis {
    turn_id: u64,
    sequence: u64,
    text: String,
}

#[derive(Serialize)]
struct WavEvent {
    turn_id: u64,
    sequence: u64,
    path: String,
}

#[derive(Serialize)]
struct ErrorEvent<'a> {
    turn_id: u64,
    message: &'a str,
}

pub fn serve() -> Result<(), String> {
    let engine = TtsEngine::start()?;
    let active_turn = Arc::new(AtomicU64::new(0));
    let worker_turn = Arc::clone(&active_turn);
    let (sender, receiver) = mpsc::channel::<Synthesis>();
    let worker = thread::spawn(move || {
        let mut engine = engine;
        while let Ok(work) = receiver.recv() {
            if worker_turn.load(Ordering::Acquire) != work.turn_id {
                continue;
            }
            match engine.synthesize(&work.text) {
                Ok(path) if worker_turn.load(Ordering::Acquire) == work.turn_id => {
                    let event = WavEvent {
                        turn_id: work.turn_id,
                        sequence: work.sequence,
                        path: path.display().to_string(),
                    };
                    let _ = write_protocol("TIBO_TTS_WAV", &event);
                }
                Ok(path) => {
                    let _ = fs::remove_file(path);
                }
                Err(message) if worker_turn.load(Ordering::Acquire) == work.turn_id => {
                    let _ = write_protocol(
                        "TIBO_TTS_ERROR",
                        &ErrorEvent {
                            turn_id: work.turn_id,
                            message: &message,
                        },
                    );
                }
                Err(_) => {}
            }
        }
    });

    let mut buffer = SentenceBuffer::default();
    let mut current_turn = 0;
    let mut sequence = 0;
    for line in io::stdin().lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        let message: ServerMessage = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(error) => {
                eprintln!("TIBO_TTS malformed input: {error}");
                continue;
            }
        };
        match message {
            ServerMessage::Delta {
                turn_id,
                text,
                final_delta,
            } => {
                if turn_id < current_turn {
                    continue;
                }
                if turn_id != current_turn {
                    buffer.clear();
                    current_turn = turn_id;
                    sequence = 0;
                    active_turn.store(turn_id, Ordering::Release);
                }
                let mut chunks = buffer.append(&text);
                if final_delta {
                    chunks.extend(buffer.finish());
                }
                for text in chunks {
                    sender
                        .send(Synthesis {
                            turn_id,
                            sequence,
                            text,
                        })
                        .map_err(|e| e.to_string())?;
                    sequence += 1;
                }
            }
            ServerMessage::Cancel { turn_id } if turn_id == current_turn => {
                buffer.clear();
                current_turn = turn_id.saturating_add(1);
                sequence = 0;
                active_turn.store(current_turn, Ordering::Release);
            }
            ServerMessage::Cancel { .. } => {}
        }
    }
    drop(sender);
    worker.join().map_err(|_| "TTS worker panicked".to_string())
}

fn write_protocol(prefix: &str, payload: &impl Serialize) -> Result<(), String> {
    let stdout = io::stdout();
    let mut out = stdout.lock();
    writeln!(
        out,
        "{prefix} {}",
        serde_json::to_string(payload).map_err(|e| e.to_string())?
    )
    .map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(DIGITS[(byte >> 4) as usize] as char);
        value.push(DIGITS[(byte & 15) as usize] as char);
    }
    value
}

fn decode_error(value: &str) -> String {
    let bytes: Vec<u8> = value
        .as_bytes()
        .chunks_exact(2)
        .filter_map(|pair| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok())
        .collect();
    String::from_utf8_lossy(&bytes).into()
}

fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
}

#[cfg(test)]
mod tests {
    use super::SentenceBuffer;

    #[test]
    fn punctuation_split_across_deltas_drains_complete_sentence() {
        let mut buffer = SentenceBuffer::default();
        assert!(buffer.append("Xin chào").is_empty());
        assert_eq!(buffer.append(". Tôi"), ["Xin chào."]);
        assert_eq!(buffer.finish(), ["Tôi"]);
    }

    #[test]
    fn decimal_point_is_not_a_sentence_end() {
        let mut buffer = SentenceBuffer::default();
        assert!(buffer.append("Claude 4.").is_empty());
        assert_eq!(buffer.append("5 và Gemini 2.5 Pro. Hết"), ["Claude 4.5 và Gemini 2.5 Pro."]);
        assert_eq!(buffer.finish(), ["Hết"]);
    }

    #[test]
    fn long_text_splits_at_first_whitespace_after_limit() {
        let mut buffer = SentenceBuffer::default();
        let text = format!("{} phần còn lại", "a".repeat(160));
        assert_eq!(buffer.append(&text), ["a".repeat(160)]);
        assert_eq!(buffer.finish(), ["phần còn lại"]);
    }

    #[test]
    fn final_delta_flushes_remainder() {
        let mut buffer = SentenceBuffer::default();
        assert!(buffer.append("Không có dấu câu").is_empty());
        assert_eq!(buffer.finish(), ["Không có dấu câu"]);
    }

    #[test]
    fn cancel_clears_buffered_text() {
        let mut buffer = SentenceBuffer::default();
        assert!(buffer.append("Phản hồi cũ").is_empty());
        buffer.clear();
        assert!(buffer.finish().is_empty());
    }
}

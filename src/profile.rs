use serde::Deserialize;
use std::{env, fs, path::PathBuf};

fn default_assistant_name() -> String {
    "Tibo".into()
}
fn default_tts_engine() -> String {
    "kokoro".into()
}
fn default_tts_voice() -> String {
    "ngoc_huyen".into()
}
fn default_stt_engine() -> String {
    "whisper".into()
}
fn default_whisper_model() -> String {
    "ggml-large-v3-turbo-q5_0.bin".into()
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
pub struct Profile {
    #[serde(default = "default_assistant_name")]
    pub assistant_name: String,
    pub vocabulary: Vec<Term>,
    #[serde(default = "default_tts_engine")]
    pub tts_engine: String,
    #[serde(default = "default_tts_voice")]
    pub tts_voice: String,
    #[serde(default = "default_stt_engine")]
    pub stt_engine: String,
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
pub struct Term {
    pub word: String,
    pub heard: Vec<String>,
}

fn default_profile() -> Profile {
    Profile {
        assistant_name: default_assistant_name(),
        tts_engine: default_tts_engine(),
        tts_voice: default_tts_voice(),
        stt_engine: default_stt_engine(),
        whisper_model: default_whisper_model(),
        ..Default::default()
    }
}

fn data_dir() -> PathBuf {
    env::var_os("TIBO_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
                .join(".local/share/tibo")
        })
}

pub fn load() -> Profile {
    let path = env::var_os("TIBO_PROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir().join("profile.json"));
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(default_profile)
}

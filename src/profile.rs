use serde::Deserialize;
use std::{env, fs, path::PathBuf};

fn default_assistant_name() -> String {
    "Tibo".into()
}
fn default_wake_words() -> Vec<String> {
    vec!["Ti bo".into()]
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
    pub onboarded: bool,
    pub user_name: String,
    #[serde(default = "default_assistant_name")]
    pub assistant_name: String,
    #[serde(default = "default_wake_words")]
    pub wake_words: Vec<String>,
    pub vocabulary: Vec<Term>,
    pub agent: String,
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
        wake_words: default_wake_words(),
        tts_engine: default_tts_engine(),
        tts_voice: default_tts_voice(),
        stt_engine: default_stt_engine(),
        whisper_model: default_whisper_model(),
        ..Default::default()
    }
}

pub fn load() -> Profile {
    let path = env::var_os("TIBO_PROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()))
                .join(".local/share/tibo/profile.json")
        });
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(default_profile)
}

/// Replaces learned recognizer spellings while preserving the transcript's original casing and spacing.
pub fn rewrite_vocabulary(transcript: &str, profile: &Profile) -> String {
    let mut output = transcript.to_owned();
    for term in &profile.vocabulary {
        if term.word.trim().is_empty() {
            continue;
        }
        for heard in &term.heard {
            replace_whole_word(&mut output, heard, &term.word);
        }
    }
    output
}

fn replace_whole_word(text: &mut String, heard: &str, replacement: &str) {
    let heard = heard.trim();
    if heard.is_empty() {
        return;
    }
    let Some(mut start) = find_case_insensitive(text, heard, 0) else {
        return;
    };
    while start < text.len() {
        let end = start + heard.len();
        if is_word_boundary(text, start, end) {
            text.replace_range(start..end, replacement);
            start += replacement.len();
        } else {
            start += text[start..].chars().next().map(char::len_utf8).unwrap_or(1);
        }
        let Some(next) = find_case_insensitive(text, heard, start) else {
            break;
        };
        start = next;
    }
}

fn find_case_insensitive(text: &str, needle: &str, from: usize) -> Option<usize> {
    text.char_indices()
        .filter(|(index, _)| *index >= from)
        .find_map(|(index, _)| {
            text[index..]
                .get(..needle.len())
                .filter(|candidate| candidate.eq_ignore_ascii_case(needle))
                .map(|_| index)
        })
}

fn is_word_boundary(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    before.is_none_or(|c| !c.is_alphanumeric()) && after.is_none_or(|c| !c.is_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_case_insensitive_whole_words() {
        let profile = Profile {
            vocabulary: vec![Term {
                word: "Safari".into(),
                heard: vec!["sá phờ ri".into(), "safari".into()],
            }],
            ..Default::default()
        };
        assert_eq!(
            rewrite_vocabulary("Mở SAFARI, nhưng safarix giữ nguyên.", &profile),
            "Mở Safari, nhưng safarix giữ nguyên."
        );
    }
}

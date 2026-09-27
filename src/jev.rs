use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fmt, fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub type Answers = HashMap<String, Answer>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Answer {
    Choice {
        choice: String,
        #[serde(default)]
        probabilities: HashMap<String, f64>,
        #[serde(default)]
        confidence: f64,
    },
    Score {
        score: f64,
        #[serde(default)]
        probabilities: HashMap<String, f64>,
        #[serde(default)]
        confidence: f64,
    },
    Noul {
        noul: f64,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage {
    #[serde(default, alias = "inputTokens")]
    pub input_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JevResponse {
    #[serde(default)]
    pub model: String,
    pub answers: Answers,
    #[serde(default)]
    pub usage: Usage,
}

#[derive(Debug)]
pub enum JevError {
    Timeout,
    Http(u16, String),
    Transport(String),
    FixtureMiss,
}

impl fmt::Display for JevError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => write!(f, "request timed out"),
            Self::Http(code, body) => write!(f, "HTTP {code}: {body}"),
            Self::Transport(message) => f.write_str(message),
            Self::FixtureMiss => f.write_str("fixture has no matching state"),
        }
    }
}

impl std::error::Error for JevError {}

#[derive(Debug, Clone)]
pub struct JevClient {
    api_key: String,
    base: String,
    model: String,
    timeout_ms: u64,
    fixture: Option<PathBuf>,
}

impl JevClient {
    pub fn from_env() -> Result<Self, JevError> {
        let fixture = env::var_os("TIBO_JEV_FIXTURE").map(PathBuf::from);
        let api_key = env::var("TYPESAFE_API_KEY").unwrap_or_default();
        if fixture.is_none() && api_key.is_empty() {
            return Err(JevError::Transport("TYPESAFE_API_KEY is required".into()));
        }
        Ok(Self {
            api_key,
            base: env::var("TIBO_JEV_BASE")
                .unwrap_or_else(|_| "https://api.typesafe.ai".into())
                .trim_end_matches('/')
                .into(),
            model: env::var("TIBO_JEV_MODEL").unwrap_or_else(|_| "jev-1.13.0".into()),
            timeout_ms: env::var("TIBO_JEV_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1500),
            fixture,
        })
    }

    pub fn system_one(&self, state: &Value, questions: &Value) -> Result<Answers, JevError> {
        self.system_one_with_meta(state, questions)
            .map(|response| response.answers)
    }

    pub fn system_one_with_meta(
        &self,
        state: &Value,
        questions: &Value,
    ) -> Result<JevResponse, JevError> {
        let started = Instant::now();
        let result = if let Some(path) = &self.fixture {
            self.from_fixture(path, state)
        } else {
            self.request(state, questions)
        };
        match &result {
            Ok(response) => eprintln!(
                "TIBO_JEV status=ok ms={} input_tokens={} model={}",
                started.elapsed().as_millis(),
                response.usage.input_tokens,
                response.model
            ),
            Err(_) => eprintln!(
                "TIBO_JEV status=err ms={} input_tokens=0 model={}",
                started.elapsed().as_millis(),
                self.model
            ),
        }
        result
    }

    fn from_fixture(&self, path: &PathBuf, state: &Value) -> Result<JevResponse, JevError> {
        let fixtures: HashMap<String, Answers> = serde_json::from_slice(
            &fs::read(path).map_err(|e| JevError::Transport(e.to_string()))?,
        )
        .map_err(|e| JevError::Transport(e.to_string()))?;
        let answers = fixtures
            .get(&state_hash(state)?)
            .cloned()
            .ok_or(JevError::FixtureMiss)?;
        Ok(JevResponse {
            model: "fixture".into(),
            answers,
            usage: Usage::default(),
        })
    }

    fn request(&self, state: &Value, questions: &Value) -> Result<JevResponse, JevError> {
        let body = json!({"state": state, "model": self.model, "questions": questions});
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_millis(self.timeout_ms)))
            .http_status_as_error(false)
            .build()
            .into();
        let url = format!("{}/v1/systemone", self.base);
        for attempt in 0..=1 {
            let response = agent
                .post(&url)
                .header("Authorization", &format!("Bearer {}", self.api_key))
                .send_json(&body);
            match response {
                Ok(mut response) if response.status().is_success() => {
                    let parsed: JevResponse = response.body_mut().read_json().map_err(map_ureq)?;
                    if let Ok(path) = env::var("TIBO_JEV_RECORD") {
                        record_fixture(PathBuf::from(path), state, &parsed.answers)?;
                    }
                    return Ok(parsed);
                }
                Ok(mut response) => {
                    let code = response.status().as_u16();
                    let message = response.body_mut().read_to_string().unwrap_or_default();
                    if attempt == 0 && matches!(code, 429 | 529) {
                        thread::sleep(Duration::from_millis(300));
                        continue;
                    }
                    return Err(JevError::Http(code, message));
                }
                Err(error) => return Err(map_ureq(error)),
            }
        }
        unreachable!()
    }
}

fn map_ureq(error: ureq::Error) -> JevError {
    if matches!(error, ureq::Error::Timeout(_)) {
        JevError::Timeout
    } else {
        JevError::Transport(error.to_string())
    }
}

pub fn state_hash(state: &Value) -> Result<String, JevError> {
    let mut child = Command::new("/usr/bin/shasum")
        .args(["-a", "256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| JevError::Transport(e.to_string()))?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(state).map_err(|e| JevError::Transport(e.to_string()))?)
        .map_err(|e| JevError::Transport(e.to_string()))?;
    let output = child
        .wait_with_output()
        .map_err(|e| JevError::Transport(e.to_string()))?;
    if !output.status.success() {
        return Err(JevError::Transport("shasum failed".into()));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .into())
}

fn record_fixture(path: PathBuf, state: &Value, answers: &Answers) -> Result<(), JevError> {
    let mut fixtures: HashMap<String, Answers> = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(|e| JevError::Transport(e.to_string()))?)
            .unwrap_or_default()
    } else {
        HashMap::new()
    };
    fixtures.insert(state_hash(state)?, answers.clone());
    let tmp = path.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(&fixtures).map_err(|e| JevError::Transport(e.to_string()))?,
    )
    .and_then(|_| fs::rename(tmp, path))
    .map_err(|e| JevError::Transport(e.to_string()))
}

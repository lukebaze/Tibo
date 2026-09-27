use crate::{
    policy::{Agent, PendingAction},
    questions::SessionSnapshot,
};
use serde::{Deserialize, Serialize};
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingConfirmation {
    #[serde(flatten)]
    pub action: PendingAction,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(default)]
    pub active: bool,
    pub agent: Option<Agent>,
    pub command: Option<String>,
    pub task: Option<String>,
    pub status: Option<String>,
    pub pid: Option<u32>,
    pub pgid: Option<u32>,
    pub log: Option<String>,
    pub started_at: Option<String>,
    pub pending_confirmation: Option<PendingConfirmation>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            active: false,
            agent: None,
            command: None,
            task: None,
            status: None,
            pid: None,
            pgid: None,
            log: None,
            started_at: None,
            pending_confirmation: None,
        }
    }
}

impl Session {
    pub fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            active: self.active,
            agent: self.agent.map(|agent| agent.as_str().to_string()),
            task: self.task.clone(),
            status: self.status.clone(),
            pending_confirmation: self
                .pending_confirmation
                .as_ref()
                .map(|pending| match &pending.action {
                    PendingAction::Closed { intent } => intent.as_str().to_string(),
                    PendingAction::Coding { agent, prompt } => {
                        format!("{}: {}", agent.as_str(), prompt)
                    }
                    PendingAction::ComputerUse { prompt } => {
                        format!("computer_use: {prompt}")
                    }
                    PendingAction::ForgetMemory { line } => {
                        format!("memory.forget: {}", line.as_deref().unwrap_or("toàn bộ"))
                    }
                }),
        }
    }
}

pub fn path() -> PathBuf {
    data_dir().join("session.json")
}

pub fn data_dir() -> PathBuf {
    PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into())).join(".local/share/tibo")
}

pub fn load() -> Session {
    let path = path();
    let mut session = match fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(session) => session,
            Err(_) => {
                eprintln!("TIBO_SESSION corrupt; reset");
                let session = Session::default();
                let _ = save(&session);
                session
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Session::default(),
        Err(error) => {
            eprintln!("TIBO_SESSION load failed: {error}");
            Session::default()
        }
    };
    if session
        .pending_confirmation
        .as_ref()
        .is_some_and(|pending| pending.expires_at <= now_rfc3339())
    {
        session.pending_confirmation = None;
        let _ = save(&session);
    }
    refresh(&mut session);
    session
}

pub fn save(session: &Session) -> io::Result<()> {
    let path = path();
    fs::create_dir_all(path.parent().unwrap())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(session)?)?;
    fs::rename(tmp, path)
}

pub fn refresh(session: &mut Session) {
    let Some(pid) = session.pid else { return };
    if !session.active || process_alive(pid) {
        return;
    }
    let exit_code = session.log.as_deref().and_then(last_exit_code);
    session.status = Some(
        if exit_code == Some(0) {
            "finished"
        } else {
            "failed"
        }
        .into(),
    );
    session.active = false;
    session.pid = None;
    session.pgid = None;
    let _ = save(session);
}

pub fn pending(action: PendingAction) -> PendingConfirmation {
    PendingConfirmation {
        action,
        expires_at: rfc3339_after(120),
    }
}

pub fn now_rfc3339() -> String {
    rfc3339_after(0)
}

fn rfc3339_after(seconds: u64) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + seconds;
    Command::new("/bin/date")
        .args(["-u", "-r", &timestamp.to_string(), "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|| timestamp.to_string())
}

fn process_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn last_exit_code(log: &str) -> Option<i32> {
    fs::read_to_string(expand_home(log))
        .ok()?
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("TIBO_CHILD_EXIT ")?.trim().parse().ok())
}

pub fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into())).join(rest);
    }
    Path::new(path).to_path_buf()
}

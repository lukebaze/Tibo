use crate::{
    jev::{Answer, Answers},
    questions::{Thresholds, Turn},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Agent {
    Omp,
    ClaudeCode,
    Codex,
}

impl Agent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Omp => "omp",
            Self::ClaudeCode => "claude_code",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClosedIntent {
    #[serde(rename = "omp.list_agents")]
    OmpListAgents,
    #[serde(rename = "claude.review_change")]
    ClaudeReviewChange,
    #[serde(rename = "codex.run_benchmark")]
    CodexRunBenchmark,
    #[serde(rename = "eva.run_evaluation")]
    EvaRunEvaluation,
    #[serde(rename = "omp.delete_all_sessions")]
    OmpDeleteAllSessions,
}

impl ClosedIntent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OmpListAgents => "omp.list_agents",
            Self::ClaudeReviewChange => "claude.review_change",
            Self::CodexRunBenchmark => "codex.run_benchmark",
            Self::EvaRunEvaluation => "eva.run_evaluation",
            Self::OmpDeleteAllSessions => "omp.delete_all_sessions",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "omp.list_agents" => Self::OmpListAgents,
            "claude.review_change" => Self::ClaudeReviewChange,
            "codex.run_benchmark" => Self::CodexRunBenchmark,
            "eva.run_evaluation" => Self::EvaRunEvaluation,
            "omp.delete_all_sessions" => Self::OmpDeleteAllSessions,
            _ => return None,
        })
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::OmpListAgents => "liệt kê agent OMP",
            Self::ClaudeReviewChange => "review thay đổi hiện tại",
            Self::CodexRunBenchmark => "chạy benchmark",
            Self::EvaRunEvaluation => "chạy đánh giá Eva",
            Self::OmpDeleteAllSessions => "xoá toàn bộ phiên OMP",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionAction {
    Stop,
    Pause,
    Continue,
    Correct { text: String },
    Append { text: String },
    Status,
    Confirm,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingAction {
    Closed { intent: ClosedIntent },
    /// `restart`: replaces the running task (a correction/addition) instead of refusing while busy.
    Coding { agent: Agent, prompt: String, #[serde(default)] restart: bool },
    /// `line: None` forgets the whole memory.
    ForgetMemory { line: Option<String> },
    /// An acting workflow (e.g. browser automation) waiting for approval; `prompt` is the request.
    Workflow { id: String, prompt: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryAction {
    Remember { fact: String },
    Recall,
    Forget { query: String },
    ForgetAll,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Ignore { reason: &'static str },
    Incomplete,
    Clarify { say: String },
    /// Unavailable GUI action; only an explicitly approved workflow may replace it.
    UnsupportedComputerUse,
    Session(SessionAction),
    Closed { intent: ClosedIntent },
    OpenApp { name: String },
    /// Read-only question about the current screen; `vision` attaches the screenshot, otherwise OCR text only.
    ReadScreen { vision: bool },
    Chat,
    Memory(MemoryAction),
    NeedConfirm { pending: PendingAction, say: String },
}

pub fn decide(turn: &Turn, answers: &Answers, thresholds: &Thresholds) -> Decision {
    let has_context = turn.session.active
        || turn.interrupted
        || turn.conversation
        || turn.session.pending_confirmation.is_some();
    if !turn.wake_matched && !has_context {
        return Decision::Ignore { reason: "no_wake" };
    }
    if !turn.wake_matched && noul(answers, "addressed_to_tibo") < thresholds.addressed_min {
        return Decision::Ignore {
            reason: "not_addressed",
        };
    }

    if turn.session.pending_confirmation.is_some() {
        return pending_reply(&turn.transcript);
    }

    let short_control = matches!(
        normalize(&turn.transcript).as_str(),
        "dung" | "tiep tuc" | "khoan" | "khoan da"
    );
    if noul(answers, "semantic_complete") < thresholds.complete_min && !short_control {
        return Decision::Incomplete;
    }

    let Some((route, route_confidence)) = choice(answers, "route") else {
        return unclear();
    };
    if route_confidence < thresholds.route_conf_min || route == "unclear" {
        return unclear();
    }

    match route {
        "session_control" => {
            if !turn.session.active {
                return Decision::Clarify {
                    say: "Hiện không có tác vụ nào đang chạy.".into(),
                };
            }
            match choice(answers, "session_action") {
                Some((action, confidence)) if confidence >= thresholds.action_conf_min => {
                    match action {
                        "stop" => Decision::Session(SessionAction::Stop),
                        "pause" => Decision::Session(SessionAction::Pause),
                        "continue" => Decision::Session(SessionAction::Continue),
                        "correct" => Decision::Session(SessionAction::Correct {
                            text: turn.transcript.clone(),
                        }),
                        "append" => Decision::Session(SessionAction::Append {
                            text: turn.transcript.clone(),
                        }),
                        "status" => Decision::Session(SessionAction::Status),
                        "confirm" => Decision::Session(SessionAction::Confirm),
                        "cancel" => Decision::Session(SessionAction::Cancel),
                        _ => unclear(),
                    }
                }
                _ => unclear(),
            }
        }
        "closed_command" => {
            let Some((name, confidence)) = choice(answers, "closed_command") else {
                return unclear();
            };
            if let Some(kind) = name.strip_prefix("memory.") {
                if confidence < thresholds.closed_conf_min {
                    return unclear();
                }
                return memory_decision(kind, &turn.transcript);
            }
            let Some(intent) = ClosedIntent::parse(name) else {
                return unclear();
            };
            if confidence < thresholds.closed_conf_min {
                return unclear();
            }
            if intent == ClosedIntent::OmpDeleteAllSessions
                || score(answers, "risk") >= thresholds.risk_confirm_min
            {
                return confirmation(PendingAction::Closed { intent }, intent.description());
            }
            Decision::Closed { intent }
        }
        "coding_task" => {
            let agent = match choice(answers, "requested_agent") {
                Some(("claude_code", confidence)) if confidence >= thresholds.agent_conf_min => {
                    Agent::ClaudeCode
                }
                Some(("codex", confidence)) if confidence >= thresholds.agent_conf_min => {
                    Agent::Codex
                }
                Some(("omp", confidence)) if confidence >= thresholds.agent_conf_min => Agent::Omp,
                _ => Agent::Omp,
            };
            // Coding agents run with write/approve-for-me permissions, so a voice task always
            // waits for approval; `risk` only picks the wording.
            let pending = PendingAction::Coding {
                agent,
                prompt: turn.transcript.clone(),
                restart: false,
            };
            if score(answers, "risk") >= thresholds.risk_confirm_min {
                confirmation(pending, "thực hiện tác vụ có rủi ro cao")
            } else {
                confirmation(pending, &format!("giao cho {}: {}", agent.as_str(), turn.transcript))
            }
        }
        "computer_use" => {
            if !turn.wake_matched {
                return Decision::Ignore { reason: "no_wake" };
            }
            match choice(answers, "computer_mode") {
                Some(("open_or_focus_app", confidence))
                    if confidence >= thresholds.action_conf_min =>
                {
                    match parse_app_name(&turn.transcript) {
                        Some(name) => Decision::OpenApp { name },
                        None => Decision::Clarify {
                            say: "Bạn muốn mở ứng dụng nào?".into(),
                        },
                    }
                }
                Some(("read_screen", confidence)) if confidence >= thresholds.action_conf_min => {
                    Decision::ReadScreen {
                        vision: needs_vision(&turn.transcript),
                    }
                }
                Some(("general", confidence)) if confidence >= thresholds.action_conf_min => {
                    Decision::UnsupportedComputerUse
                }
                _ => unclear(),
            }
        }
        "conversation" => Decision::Chat,
        _ => unclear(),
    }
}

/// Keyword routing used only when Jev is unreachable. It has none of Jev's confidence gates, so it
/// never approves a pending action on a partial match and never starts anything with side effects:
/// those turns get a clarifying question until Jev is back.
pub fn decide_fallback(turn: &Turn) -> Decision {
    let text = normalize(&turn.transcript);
    let has_context =
        turn.session.active || turn.interrupted || turn.session.pending_confirmation.is_some();
    if !turn.wake_matched && !has_context {
        return Decision::Ignore { reason: "no_wake" };
    }
    if turn.session.pending_confirmation.is_some() {
        // Without Jev's addressed check, only an explicit wake or typed turn may resolve it.
        return if turn.wake_matched {
            pending_reply(&turn.transcript)
        } else {
            Decision::Ignore { reason: "no_wake" }
        };
    }
    if let Some(decision) = memory_fallback(&turn.transcript) {
        return decision;
    }
    if turn.session.active {
        if contains_any(&text, &["dung", "khoan", "stop"]) {
            return Decision::Session(SessionAction::Stop);
        }
        if contains_any(&text, &["tiep tuc", "resume"]) {
            return Decision::Session(SessionAction::Continue);
        }
        if contains_any(&text, &["den dau", "trang thai", "status"]) {
            return Decision::Session(SessionAction::Status);
        }
    }
    if let Some(name) = parse_app_name(&turn.transcript) {
        return Decision::OpenApp { name };
    }
    if contains_any(
        &text,
        &["man hinh", "trang nay", "cua so nay", "loi nay", "doan nay", "tren screen", "screen"],
    ) {
        return Decision::ReadScreen {
            vision: needs_vision(&turn.transcript),
        };
    }
    if contains_any(&text, &["omp", "agent", "tac tu", "liet ke", "danh sach", "dang chay"]) {
        return Decision::Closed { intent: ClosedIntent::OmpListAgents };
    }
    let side_effect = [
        "session", "phien", "lich su", "history", "delete", "remove", "purge", "erase", "clear", "xoa",
        "claude", "review", "codex", "benchmark", "bench", "eva", "danh gia",
    ];
    if contains_any(&text, &side_effect) {
        return Decision::Clarify {
            say: "Mình đang mất kết nối bộ định tuyến, chưa chạy lệnh này được. Bạn thử lại sau nhé.".into(),
        };
    }
    Decision::Chat
}

fn pending_reply(transcript: &str) -> Decision {
    let words: String = normalize(transcript)
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    match words.as_str() {
        "xac nhan" | "dong y" | "confirm" | "tibo xac nhan" | "tibo dong y" => {
            Decision::Session(SessionAction::Confirm)
        }
        "huy" | "huy lenh" | "huy lenh do" | "cancel" | "khong dong y" | "tibo huy" => {
            Decision::Session(SessionAction::Cancel)
        }
        _ => Decision::Clarify { say: "Bạn xác nhận hay huỷ lệnh đang chờ?".into() },
    }
}

/// ponytail: keyword split between OCR (fast, on-device text) and a screenshot for a vision model;
/// upgrade to a Jev `screen_detail` question if users ask visual questions without these words.
fn needs_vision(transcript: &str) -> bool {
    // "màn hình" (screen) is in most screen questions; only a standalone "hình" means a picture.
    let text = transcript.to_lowercase().replace("màn hình", "");
    [
        "ảnh", "hình", "nhìn", "trông", "giao diện", "màu", "biểu đồ", "bố cục", "biểu tượng", "icon", "chart",
        "image", "look",
    ]
    .iter()
    .any(|word| text.contains(word))
}

const REMEMBER_TRIGGERS: &[&[&str]] = &[
    &["ghi", "nho", "la"],
    &["ghi", "nho", "rang"],
    &["ghi", "nho"],
    &["nho", "giup", "toi", "la"],
    &["nho", "la"],
    &["nho", "rang"],
    &["remember", "that"],
    &["remember"],
];
const FORGET_TRIGGERS: &[&[&str]] = &[&["quen"], &["forget"]];

/// Text after a trigger that opens the utterance (optionally after hãy/bạn/này/ơi), original
/// wording kept; `skip` words right after the trigger and `tail` fillers at the end are dropped.
/// ponytail: start-anchored keywords only; Jev's closed_command covers other phrasings.
fn words_after(transcript: &str, triggers: &[&[&str]], skip: &[&str], tail: &[&str]) -> Option<String> {
    let original: Vec<&str> = transcript.split_whitespace().collect();
    let norm: Vec<String> = original
        .iter()
        .map(|word| normalize(word).trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .collect();
    let lead = norm.first().is_some_and(|w| matches!(w.as_str(), "hay" | "ban" | "nay" | "oi"));
    for start in 0..=usize::from(lead) {
        for trigger in triggers {
            let end = start + trigger.len();
            if norm.len() < end || norm[start..end].iter().zip(trigger.iter()).any(|(a, b)| a != b) {
                continue;
            }
            let mut from = end;
            while from < norm.len() && skip.contains(&norm[from].as_str()) {
                from += 1;
            }
            let mut to = norm.len();
            while to > from && tail.contains(&norm[to - 1].as_str()) {
                to -= 1;
            }
            let text = original[from..to].join(" ");
            return Some(text.trim_matches(|c: char| matches!(c, ',' | '.' | '!' | '?' | ':')).trim().into());
        }
    }
    None
}

fn memory_decision(kind: &str, transcript: &str) -> Decision {
    match kind {
        "recall" => Decision::Memory(MemoryAction::Recall),
        "remember" => {
            let fact = words_after(transcript, REMEMBER_TRIGGERS, &["la", "rang", "that"], &["nhe", "nha"])
                .unwrap_or_else(|| transcript.trim().into());
            if fact.is_empty() {
                Decision::Clarify { say: "Bạn muốn mình nhớ điều gì?".into() }
            } else {
                Decision::Memory(MemoryAction::Remember { fact })
            }
        }
        "forget" => {
            let skip = ["di", "chuyen", "viec", "dieu", "la", "rang", "ve", "cai", "about"];
            let query = words_after(transcript, FORGET_TRIGGERS, &skip, &["di", "nhe", "nha"])
                .unwrap_or_else(|| transcript.trim().into());
            match normalize(&query).as_str() {
                "" => Decision::Clarify { say: "Bạn muốn mình quên chuyện gì?".into() },
                "het" | "tat ca" | "het tat ca" | "moi thu" | "het moi thu" | "everything" | "all" => {
                    Decision::Memory(MemoryAction::ForgetAll)
                }
                _ => Decision::Memory(MemoryAction::Forget { query }),
            }
        }
        _ => unclear(),
    }
}

fn memory_fallback(transcript: &str) -> Option<Decision> {
    let text = normalize(transcript);
    if contains_any(&text, &["nho gi ve", "nho nhung gi", "biet gi ve toi", "remember about me"]) {
        return Some(Decision::Memory(MemoryAction::Recall));
    }
    if words_after(transcript, REMEMBER_TRIGGERS, &[], &[]).is_some() {
        return Some(memory_decision("remember", transcript));
    }
    words_after(transcript, FORGET_TRIGGERS, &[], &[]).map(|_| memory_decision("forget", transcript))
}

fn confirmation(pending: PendingAction, description: &str) -> Decision {
    Decision::NeedConfirm {
        pending,
        say: format!("Cần phê duyệt: {description}. Nói 'xác nhận' hoặc 'huỷ'."),
    }
}

fn unclear() -> Decision {
    Decision::Clarify {
        say: "Tôi chưa nghe rõ, bạn nói lại được không?".into(),
    }
}

fn choice<'a>(answers: &'a Answers, id: &str) -> Option<(&'a str, f64)> {
    match answers.get(id)? {
        Answer::Choice {
            choice, confidence, ..
        } => Some((choice, *confidence)),
        _ => None,
    }
}

fn noul(answers: &Answers, id: &str) -> f64 {
    match answers.get(id) {
        Some(Answer::Noul { noul }) => *noul,
        _ => 0.0,
    }
}

fn score(answers: &Answers, id: &str) -> f64 {
    match answers.get(id) {
        Some(Answer::Score { score, .. }) => *score,
        _ => 0.0,
    }
}

fn contains_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| text.contains(word))
}

fn parse_app_name(input: &str) -> Option<String> {
    let original: Vec<&str> = input.split_whitespace().collect();
    let normalized: Vec<String> = original
        .iter()
        .map(|word| {
            normalize(word)
                .trim_matches(|c: char| matches!(c, ',' | '.' | '!' | '?' | ':'))
                .to_string()
        })
        .collect();
    let prefix = if normalized.starts_with(&["chuyen".into(), "sang".into()]) {
        2
    } else if normalized
        .first()
        .is_some_and(|word| matches!(word.as_str(), "mo" | "bat" | "open" | "launch" | "focus"))
    {
        1
    } else {
        return None;
    };
    let mut start = prefix;
    if normalized.get(start).map(String::as_str) == Some("app") {
        start += 1;
    } else if normalized.get(start).map(String::as_str) == Some("ung")
        && normalized.get(start + 1).map(String::as_str) == Some("dung")
    {
        start += 2;
    }
    let mut end = original.len();
    if normalized.get(end.wrapping_sub(1)).map(String::as_str) == Some("di") {
        end -= 1;
    }
    if end >= start + 2
        && matches!(
            (normalized[end - 2].as_str(), normalized[end - 1].as_str()),
            ("giup", "toi") | ("cho", "toi")
        )
    {
        end -= 2;
    }
    if start >= end
        || normalized[start..end]
            .iter()
            .any(|word| matches!(word.as_str(), "roi" | "va" | "vao" | "then" | "and"))
    {
        return None;
    }
    let name = original[start..end]
        .join(" ")
        .trim_matches(|c: char| matches!(c, ',' | '.' | '!' | '?' | ':'))
        .trim()
        .to_string();
    let length = name.chars().count();
    (length >= 1 && length <= 80 && !name.chars().any(char::is_control)).then_some(name)
}

pub fn normalize(input: &str) -> String {
    input
        .to_lowercase()
        .chars()
        // Decomposed (NFD) input: drop combining marks so "màn" typed as m-a-U+0300-n still folds to "man".
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .map(|c| match c {
            'à' | 'á' | 'ạ' | 'ả' | 'ã' | 'â' | 'ầ' | 'ấ' | 'ậ' | 'ẩ' | 'ẫ' | 'ă' | 'ằ' | 'ắ'
            | 'ặ' | 'ẳ' | 'ẵ' => 'a',
            'è' | 'é' | 'ẹ' | 'ẻ' | 'ẽ' | 'ê' | 'ề' | 'ế' | 'ệ' | 'ể' | 'ễ' => {
                'e'
            }
            'ì' | 'í' | 'ị' | 'ỉ' | 'ĩ' => 'i',
            'ò' | 'ó' | 'ọ' | 'ỏ' | 'õ' | 'ô' | 'ồ' | 'ố' | 'ộ' | 'ổ' | 'ỗ' | 'ơ' | 'ờ' | 'ớ'
            | 'ợ' | 'ở' | 'ỡ' => 'o',
            'ù' | 'ú' | 'ụ' | 'ủ' | 'ũ' | 'ư' | 'ừ' | 'ứ' | 'ự' | 'ử' | 'ữ' => {
                'u'
            }
            'ỳ' | 'ý' | 'ỵ' | 'ỷ' | 'ỹ' => 'y',
            'đ' => 'd',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::questions::SessionSnapshot;
    use std::collections::HashMap;

    fn turn(text: &str) -> Turn {
        Turn {
            transcript: text.into(),
            wake_matched: true,
            asr_language: "vi".into(),
            interrupted: false,
            conversation: false,
            session: SessionSnapshot::default(),
            recent: Vec::new(),
        }
    }

    #[test]
    fn conversation_follow_up_needs_no_wake_word_but_must_be_addressed() {
        let mut follow_up = turn("còn ngày mai thì sao");
        follow_up.wake_matched = false;
        let thresholds = Thresholds::default();
        assert_eq!(decide(&follow_up, &answers("conversation"), &thresholds), Decision::Ignore { reason: "no_wake" });

        follow_up.conversation = true;
        assert_eq!(decide(&follow_up, &answers("conversation"), &thresholds), Decision::Chat);

        let mut overheard = answers("conversation");
        overheard.insert("addressed_to_tibo".into(), Answer::Noul { noul: 0.1 });
        assert_eq!(decide(&follow_up, &overheard, &thresholds), Decision::Ignore { reason: "not_addressed" });
        // Without Jev there is no addressed check, so the keyword fallback still wants the wake word.
        assert_eq!(decide_fallback(&follow_up), Decision::Ignore { reason: "no_wake" });
    }

    fn answers(route: &str) -> Answers {
        let mut a = HashMap::new();
        a.insert("addressed_to_tibo".into(), Answer::Noul { noul: 1.0 });
        a.insert("semantic_complete".into(), Answer::Noul { noul: 1.0 });
        a.insert(
            "route".into(),
            Answer::Choice {
                choice: route.into(),
                probabilities: HashMap::new(),
                confidence: 0.99,
            },
        );
        a.insert(
            "computer_mode".into(),
            Answer::Choice {
                choice: "none".into(),
                probabilities: HashMap::new(),
                confidence: 0.99,
            },
        );
        a.insert(
            "session_action".into(),
            Answer::Choice {
                choice: "none".into(),
                probabilities: HashMap::new(),
                confidence: 0.99,
            },
        );
        a.insert(
            "closed_command".into(),
            Answer::Choice {
                choice: "none".into(),
                probabilities: HashMap::new(),
                confidence: 0.99,
            },
        );
        a.insert(
            "requested_agent".into(),
            Answer::Choice {
                choice: "unspecified".into(),
                probabilities: HashMap::new(),
                confidence: 0.99,
            },
        );
        a.insert(
            "risk".into(),
            Answer::Score {
                score: 0.0,
                probabilities: HashMap::new(),
                confidence: 0.99,
            },
        );
        a
    }

    #[test]
    fn no_wake_is_ignored() {
        let mut value = turn("hello");
        value.wake_matched = false;
        assert!(matches!(
            decide(&value, &answers("conversation"), &Thresholds::default()),
            Decision::Ignore { reason: "no_wake" }
        ));
    }

    #[test]
    fn pending_confirmation_accepts_confirm() {
        let mut value = turn("xác nhận");
        value.wake_matched = false;
        value.session.pending_confirmation = Some("coding_task".into());
        let mut a = answers("session_control");
        set_choice(&mut a, "session_action", "cancel");
        assert_eq!(decide(&value, &a, &Thresholds::default()), Decision::Session(SessionAction::Confirm));
    }

    #[test]
    fn incomplete_utterance_listens_again() {
        let mut a = answers("coding_task");
        a.insert("semantic_complete".into(), Answer::Noul { noul: 0.0 });
        assert!(matches!(
            decide(&turn("nhờ codex"), &a, &Thresholds::default()),
            Decision::Incomplete
        ));
    }

    #[test]
    fn unclear_route_clarifies() {
        assert!(matches!(
            decide(&turn("gì đó"), &answers("unclear"), &Thresholds::default()),
            Decision::Clarify { .. }
        ));
    }

    #[test]
    fn stop_controls_active_session() {
        let mut value = turn("dừng");
        value.session.active = true;
        let mut a = answers("session_control");
        set_choice(&mut a, "session_action", "stop");
        assert!(matches!(
            decide(&value, &a, &Thresholds::default()),
            Decision::Session(SessionAction::Stop)
        ));
    }

    #[test]
    fn stop_without_session_clarifies() {
        let mut a = answers("session_control");
        set_choice(&mut a, "session_action", "stop");
        assert!(matches!(
            decide(&turn("dừng"), &a, &Thresholds::default()),
            Decision::Clarify { .. }
        ));
    }

    #[test]
    fn session_deletion_requires_confirmation() {
        let mut a = answers("closed_command");
        set_choice(&mut a, "closed_command", "omp.delete_all_sessions");
        assert!(matches!(
            decide(&turn("xoá hết session"), &a, &Thresholds::default()),
            Decision::NeedConfirm { .. }
        ));
    }

    #[test]
    fn coding_honors_requested_codex() {
        let mut a = answers("coding_task");
        set_choice(&mut a, "requested_agent", "codex");
        assert!(matches!(
            decide(&turn("codex sửa lỗi"), &a, &Thresholds::default()),
            Decision::NeedConfirm {
                pending: PendingAction::Coding { agent: Agent::Codex, .. },
                ..
            }
        ));
    }

    #[test]
    fn risky_coding_requires_confirmation() {
        let mut a = answers("coding_task");
        a.insert(
            "risk".into(),
            Answer::Score {
                score: 2.0,
                probabilities: HashMap::new(),
                confidence: 0.9,
            },
        );
        assert!(matches!(
            decide(&turn("drop database"), &a, &Thresholds::default()),
            Decision::NeedConfirm { .. }
        ));
    }

    #[test]
    fn no_wake_computer_command_is_ignored_even_with_active_session() {
        let mut value = turn("mở Safari");
        value.wake_matched = false;
        value.session.active = true;
        let mut a = answers("computer_use");
        set_choice(&mut a, "computer_mode", "open_or_focus_app");
        assert!(matches!(
            decide(&value, &a, &Thresholds::default()),
            Decision::Ignore { reason: "no_wake" }
        ));
    }

    #[test]
    fn named_app_opens_without_confirmation() {
        let mut a = answers("computer_use");
        set_choice(&mut a, "computer_mode", "open_or_focus_app");
        assert_eq!(
            decide(&turn("mở Safari giúp tôi."), &a, &Thresholds::default()),
            Decision::OpenApp {
                name: "Safari".into()
            }
        );
    }

    #[test]
    fn screen_questions_answer_without_confirmation() {
        let mut a = answers("computer_use");
        set_choice(&mut a, "computer_mode", "read_screen");
        let t = Thresholds::default();
        // "anh" (pronoun) must not trigger vision; "ảnh"/"biểu đồ" must.
        assert_eq!(decide(&turn("anh xem lỗi này nghĩa là gì"), &a, &t), Decision::ReadScreen { vision: false });
        assert_eq!(decide(&turn("biểu đồ trong ảnh này nói gì"), &a, &t), Decision::ReadScreen { vision: true });
        assert_eq!(decide_fallback(&turn("trên màn hình đang có gì")), Decision::ReadScreen { vision: false });
        let decomposed = "tre\u{302}n ma\u{300}n hi\u{300}nh đang co\u{301} gi\u{300}";
        assert_eq!(decide_fallback(&turn(decomposed)), Decision::ReadScreen { vision: false });
        assert_eq!(decide_fallback(&turn("mở Safari")), Decision::OpenApp { name: "Safari".into() });
    }

    #[test]
    fn compound_computer_request_never_opens_directly() {
        let mut a = answers("computer_use");
        set_choice(&mut a, "computer_mode", "open_or_focus_app");
        assert!(matches!(
            decide(
                &turn("open Safari rồi vào GitHub"),
                &a,
                &Thresholds::default()
            ),
            Decision::Clarify { .. }
        ));
    }

    #[test]
    fn missing_app_target_clarifies() {
        let mut a = answers("computer_use");
        set_choice(&mut a, "computer_mode", "open_or_focus_app");
        assert!(matches!(
            decide(&turn("mở ứng dụng giúp tôi"), &a, &Thresholds::default()),
            Decision::Clarify { .. }
        ));
    }

    #[test]
    fn unsupported_computer_use_does_not_request_approval() {
        let mut a = answers("computer_use");
        set_choice(&mut a, "computer_mode", "general");
        assert_eq!(
            decide(&turn("mở VN Express trên Safari"), &a, &Thresholds::default()),
            Decision::UnsupportedComputerUse
        );
    }

    #[test]
    fn pending_confirmation_only_accepts_explicit_words() {
        let mut value = turn("đúng");
        value.session.pending_confirmation = Some("coding_task".into());
        let mut a = answers("session_control");
        set_choice(&mut a, "session_action", "cancel");
        assert!(matches!(decide(&value, &a, &Thresholds::default()), Decision::Clarify { .. }));
        assert!(matches!(decide_fallback(&value), Decision::Clarify { .. }));

        value.transcript = "huỷ".into();
        set_choice(&mut a, "session_action", "confirm");
        assert_eq!(decide(&value, &a, &Thresholds::default()), Decision::Session(SessionAction::Cancel));
        value.wake_matched = false;
        assert_eq!(decide_fallback(&value), Decision::Ignore { reason: "no_wake" });
    }

    #[test]
    fn conversation_returns_chat() {
        assert_eq!(
            decide(
                &turn("chào bạn"),
                &answers("conversation"),
                &Thresholds::default()
            ),
            Decision::Chat
        );
    }

    #[test]
    fn fallback_never_runs_or_approves_side_effects() {
        assert!(matches!(decide_fallback(&turn("xoá hết session")), Decision::Clarify { .. }));
        assert!(matches!(decide_fallback(&turn("chạy đánh giá eva")), Decision::Clarify { .. }));
        let mut pending = turn("không đồng ý");
        pending.wake_matched = false;
        pending.session.pending_confirmation = Some("coding_task".into());
        assert_eq!(decide_fallback(&pending), Decision::Ignore { reason: "no_wake" });
        pending.wake_matched = true;
        assert_eq!(decide_fallback(&pending), Decision::Session(SessionAction::Cancel));
        pending.transcript = "đồng ý à, để tôi nghĩ".into();
        assert!(matches!(decide_fallback(&pending), Decision::Clarify { .. }));
        pending.transcript = "Đồng ý.".into();
        assert_eq!(decide_fallback(&pending), Decision::Session(SessionAction::Confirm));
    }

    #[test]
    fn fallback_opens_explicit_apps_and_keeps_unknown_input_conversational() {
        assert_eq!(
            decide_fallback(&turn("mở Safari")),
            Decision::OpenApp {
                name: "Safari".into()
            }
        );
        assert_eq!(decide_fallback(&turn("hôm nay thế nào")), Decision::Chat);
    }

    #[test]
    fn fallback_memory_commands_extract_their_object() {
        let remember = |fact: &str| Decision::Memory(MemoryAction::Remember { fact: fact.into() });
        assert_eq!(decide_fallback(&turn("nhớ là tôi thích trả lời ngắn nhé")), remember("tôi thích trả lời ngắn"));
        assert_eq!(decide_fallback(&turn("hãy ghi nhớ rằng mai họp 9 giờ.")), remember("mai họp 9 giờ"));
        assert_eq!(decide_fallback(&turn("bạn nhớ gì về tôi?")), Decision::Memory(MemoryAction::Recall));
        assert_eq!(
            decide_fallback(&turn("quên chuyện cà phê đi")),
            Decision::Memory(MemoryAction::Forget { query: "cà phê".into() })
        );
        assert_eq!(decide_fallback(&turn("quên hết đi")), Decision::Memory(MemoryAction::ForgetAll));
        assert!(matches!(decide_fallback(&turn("quên đi")), Decision::Clarify { .. }));
        assert_eq!(decide_fallback(&turn("tôi nhớ là hôm qua trời mưa")), Decision::Chat, "only command-initial triggers");
    }

    fn set_choice(answers: &mut Answers, id: &str, value: &str) {
        answers.insert(
            id.into(),
            Answer::Choice {
                choice: value.into(),
                probabilities: HashMap::new(),
                confidence: 0.9,
            },
        );
    }
}

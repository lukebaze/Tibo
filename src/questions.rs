use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub active: bool,
    pub agent: Option<String>,
    pub task: Option<String>,
    pub status: Option<String>,
    pub pending_confirmation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    pub transcript: String,
    pub wake_matched: bool,
    pub asr_language: String,
    pub interrupted: bool,
    pub session: SessionSnapshot,
}

pub fn build_state(turn: &Turn) -> Value {
    json!({
        "transcript": turn.transcript,
        "asr": {
            "language": turn.asr_language,
            "wake_word_matched": turn.wake_matched
        },
        "assistant": {
            "name": "Graviz",
            "was_speaking_when_user_spoke": turn.interrupted
        },
        "session": {
            "active": turn.session.active,
            "agent": turn.session.agent,
            "task": turn.session.task,
            "status": turn.session.status,
            "pending_confirmation": turn.session.pending_confirmation
        }
    })
}

pub fn questions() -> Value {
    json!({
        "addressed_to_graviz": {
            "type": "noul",
            "instructions": "The transcript may be Vietnamese or mixed Vietnamese-English and may contain ASR errors. Decide whether the user is speaking to the voice assistant Graviz. Session context or an interruption can make an utterance addressed even without the wake word.",
            "criteria": {
                "true": "The user is speaking to Graviz or controlling the active Graviz task.",
                "false": "Background speech, another person, dictation, or self-talk not directed at Graviz."
            }
        },
        "semantic_complete": {
            "type": "noul",
            "instructions": "Decide whether the ASR transcript is a complete actionable utterance. Vietnamese requests often omit pronouns and are still complete. Short controls such as dừng, dừng lại ngay, khoan đã, tạm dừng, tiếp tục, xác nhận, and huỷ are complete.",
            "criteria": {
                "true": "Complete request, question, or short control. Examples: cho xem các agent omp; bench hiệu năng phân loại; claude audit thay đổi; thêm cả smoke test when a session is active.",
                "false": "Cut off mid-sentence or missing its object. Examples: mở giúp tôi cái; nhờ codex; chạy cái; đổi giúp cái này thành."
            }
        },
        "route": {
            "type": "choice",
            "instructions": "Classify the user's intent. The transcript may be Vietnamese, mixed Vietnamese-English, and imperfect ASR. Use active session context: a short correction or addition refers to session.task. Choose unclear only when the utterance truly lacks an action or object, not merely because Vietnamese wording is informal.",
            "criteria": {
                "session_control": "Control the active session: dừng/dừng lại/khoan=stop, tạm dừng/pause=pause, tiếp tục=continue, đến đâu rồi/status=status, không dùng X/sửa yêu cầu=correct, thêm/bổ sung=append, xác nhận=confirm, huỷ/cancel=cancel.",
                "closed_command": "One fixed command: list/status OMP agents; review/audit the current diff with Claude; run/measure benchmark; validate/run Eva; delete/purge all OMP sessions. Examples: trạng thái các tác tử omp; duyệt code tôi vừa sửa; đo benchmark tiếng việt; kiểm tra bộ dữ liệu eva.",
                "coding_task": "An open-ended software task that changes or investigates code. Examples: sửa lỗi đăng nhập; thêm endpoint; refactor auth; thêm cả smoke test when no session exists.",
                "computer_use": "Operate an application, browser, website, payment, or GUI outside coding agents.",
                "conversation": "Complete non-actionable conversation directed to Graviz.",
                "unclear": "The action or object is missing, such as nhờ codex, chạy cái, mở giúp tôi cái."
            }
        },
        "session_action": {
            "type": "choice",
            "instructions": "Choose the active-session control action, or none when this is not session control. Vietnamese khoan đã/dừng lại means stop; tạm dừng means pause.",
            "criteria": {
                "stop": "Terminate the active task. Examples: dừng, dừng lại ngay, khoan đã.",
                "pause": "Temporarily pause it. Examples: tạm dừng, pause task.",
                "continue": "Resume it. Examples: tiếp tục, chạy tiếp, continue.",
                "correct": "Replace/restart it with a correction. Examples: không, dùng codex; sửa yêu cầu thành.",
                "append": "Restart it with an additional requirement. Examples: thêm cả smoke test; bổ sung kiểm tra lỗi mạng.",
                "status": "Report current task status. Examples: đến đâu rồi; báo trạng thái.",
                "confirm": "Approve the pending confirmation. Examples: xác nhận; đồng ý.",
                "cancel": "Reject the pending confirmation. Examples: huỷ lệnh đó; cancel đi.",
                "none": "No session action is requested."
            }
        },
        "closed_command": {
            "type": "choice",
            "instructions": "Choose a fixed command when its action is explicit, including informal Vietnamese synonyms; otherwise none.",
            "criteria": {
                "omp.list_agents": "List or report OMP agents/sessions. Examples: cho xem các agent omp; trạng thái các tác tử omp; omp có agent nào.",
                "claude.review_change": "Review, audit, duyệt, or xem lại the current code/diff/change. Examples: duyệt code tôi vừa sửa; claude audit phần thay đổi.",
                "codex.run_benchmark": "Run, measure, bench, or đo Graviz's benchmark. Examples: bench hiệu năng phân loại; đo benchmark tiếng việt.",
                "eva.run_evaluation": "Validate, inspect, or run the local Eva evaluation. Examples: kiểm tra bộ dữ liệu eva; validate eva.",
                "omp.delete_all_sessions": "Delete, clear, purge, dọn sạch, or remove all OMP sessions/history.",
                "none": "No fixed command was explicitly requested."
            }
        },
        "requested_agent": {
            "type": "choice",
            "instructions": "Choose an agent only when the user explicitly names it.",
            "criteria": {
                "omp": "The user explicitly requests OMP.",
                "claude_code": "The user explicitly requests Claude or Claude Code.",
                "codex": "The user explicitly requests Codex.",
                "unspecified": "No coding agent was named."
            }
        },
        "risk": {
            "type": "score",
            "instructions": "Score the highest plausible consequence, not just the grammatical tone. Always choose level 2 for delete/purge/clear all sessions or credentials, rm -rf, drop database, force push/reset main, publish secrets, production changes, payments, or irreversible data loss.",
            "criteria": [
                "Read-only or informational",
                "Modifies local files or sessions but reversible",
                "Destructive or irreversible: delete/purge, rm -rf, drop database, force push/reset main, credentials/secrets, production, payments, or data loss"
            ]
        },
        "needs_reasoning": {
            "type": "noul",
            "instructions": "Decide whether this request needs an LLM to plan, explain, investigate, or code rather than a fixed local action.",
            "criteria": {
                "true": "Open-ended reasoning or coding is needed.",
                "false": "A fixed command or direct session action is sufficient."
            }
        }
    })
}

#[derive(Debug, Clone, Copy)]
pub struct Thresholds {
    pub addressed_min: f64,
    pub complete_min: f64,
    pub route_conf_min: f64,
    pub action_conf_min: f64,
    pub closed_conf_min: f64,
    pub agent_conf_min: f64,
    pub risk_confirm_min: f64,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self {
            addressed_min: 0.5,
            complete_min: 0.4,
            route_conf_min: 0.4,
            action_conf_min: 0.45,
            closed_conf_min: 0.45,
            agent_conf_min: 0.45,
            risk_confirm_min: 1.5,
        }
    }
}

pub const ADDRESSED_MIN: f64 = 0.5;
pub const COMPLETE_MIN: f64 = 0.4;
pub const ROUTE_CONF_MIN: f64 = 0.4;
pub const ACTION_CONF_MIN: f64 = 0.45;
pub const CLOSED_CONF_MIN: f64 = 0.45;
pub const AGENT_CONF_MIN: f64 = 0.45;
pub const RISK_CONFIRM_MIN: f64 = 1.5;

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
    /// Tibo answered within the last 15 minutes: a follow-up needs no wake word, only Jev's
    /// addressed_to_tibo check.
    #[serde(default)]
    pub conversation: bool,
    pub session: SessionSnapshot,
    /// Latest logged turns (`memory::recent_turns`), so follow-ups like "còn Đức?" keep their route.
    #[serde(default)]
    pub recent: Vec<String>,
}

pub fn build_state(turn: &Turn) -> Value {
    let assistant_name = crate::profile::load().assistant_name;
    let mut state = json!({
        "transcript": turn.transcript,
        "asr": {
            "language": turn.asr_language,
            "wake_word_matched": turn.wake_matched
        },
        "assistant": {
            "name": assistant_name,
            "was_speaking_when_user_spoke": turn.interrupted
        },
        "session": {
            "active": turn.session.active,
            "agent": turn.session.agent,
            "task": turn.session.task,
            "status": turn.session.status,
            "pending_confirmation": turn.session.pending_confirmation
        },
        "recent_conversation": turn.recent
    });
    if turn.conversation {
        state["assistant"]["in_conversation_with_user"] = json!(true);
    }
    state
}

pub fn questions() -> Value {
    let name = crate::profile::load().assistant_name;
    json!({
        "addressed_to_tibo": {
            "type": "noul",
            "instructions": format!("The transcript may be Vietnamese or mixed Vietnamese-English and may contain ASR errors. Decide whether the user is speaking to the voice assistant {name}. When session.active is true, a short command controlling, correcting, or extending the running task (dừng, khoan đã, tiếp tục, chạy tiếp, đến đâu rồi, xác nhận, huỷ, thêm cả smoke test, sửa yêu cầu thành...) is addressed even without the wake word. Session context, an interruption, or an ongoing conversation (assistant.in_conversation_with_user, see recent_conversation) can make an utterance addressed even without the wake word; in a conversation, a follow-up question or request is addressed, but talk to other people or media audio is not."),
            "criteria": {
                "true": format!("The user is speaking to {name} or controlling the active {name} task."),
                "false": "Background speech, another person, dictation, or self-talk not directed at the assistant."
            }
        },
        "semantic_complete": {
            "type": "noul",
            "instructions": "Decide whether the ASR transcript is a complete actionable utterance. Vietnamese requests often omit pronouns and are still complete. Questions pointing at what is on screen with này/đó/trang này/đoạn này are complete. When session.active is true, dừng, tạm dừng, tiếp tục, không dùng codex để làm lại, thêm cả smoke test, bổ sung kiểm tra lỗi mạng, xác nhận, and huỷ are complete.",
            "criteria": {
                "true": "Complete request, question, or active-session control/correction/addition. Examples: cho xem các agent omp; bench hiệu năng phân loại; thêm cả smoke test; bổ sung kiểm tra lỗi mạng; lỗi này nghĩa là gì; tóm tắt trang này.",
                "false": "Cut off mid-sentence or missing its object or destination. Examples: mở giúp tôi cái; nhờ codex; chạy cái; vào trang rồi; đổi giúp cái này thành."
            }
        },
        "route": {
            "type": "choice",
            "instructions": "Classify the user's intent. The transcript may be Vietnamese, mixed Vietnamese-English, and imperfect ASR. Use active session context: a short correction or addition refers to session.task. A short follow-up such as còn Đức? or còn cái kia? continues recent_conversation and keeps its route. Choose unclear only when the utterance truly lacks an action or object, not merely because Vietnamese wording is informal.",
            "criteria": {
                "session_control": "Control the active session: dừng/dừng lại/khoan=stop, tạm dừng/pause=pause, tiếp tục=continue, đến đâu rồi/status=status, không dùng codex để làm lại/sửa yêu cầu=correct, thêm cả smoke test/bổ sung kiểm tra lỗi mạng=append, xác nhận=confirm, huỷ/cancel=cancel.",
                "closed_command": "One fixed command: list/status OMP agents; review/audit the current diff with Claude; run/measure benchmark; validate/run Eva; delete/purge/dọn sạch all OMP sessions or session history; remember, recall, or forget something about the user. Examples: dọn sạch lịch sử phiên; trạng thái các tác tử omp; duyệt code tôi vừa sửa; đo benchmark tiếng việt; nhớ là tôi thích trả lời ngắn; bạn nhớ gì về tôi; quên chuyện cà phê.",
                "coding_task": "An open-ended software task that changes or investigates source code, including implementing UI appearance. Examples: đổi màu nút chính sang xanh; sửa lỗi đăng nhập; thêm endpoint; refactor auth. Do not classify source-code UI changes as computer_use.",
                "computer_use": "Operate or look at the actual macOS application, browser, website, payment, or GUI outside source code, including questions about what is currently on screen. Examples: mở Safari; open Safari rồi vào GitHub; thanh toán hoá đơn; trên màn hình đang có gì; lỗi này nghĩa là gì; tóm tắt trang đang mở; dịch đoạn này sang tiếng Anh. A missing website or app target such as vào trang rồi is unclear.",
                "conversation": format!("Complete non-actionable conversation directed to {name}."),
                "unclear": "The action, object, or destination is missing, such as nhờ codex, chạy cái, mở giúp tôi cái, vào trang rồi."
            }
        },
        "computer_mode": {
            "type": "choice",
            "instructions": "Classify only computer-use requests. Opening or focusing exactly one named macOS app and doing nothing else is open_or_focus_app. Only looking at, reading, summarizing, translating, or explaining what is already visible, without clicking or typing, is read_screen. Any interaction, navigation after opening, form submission, message, or payment is general. Choose none for every non-computer-use request.",
            "criteria": {
                "open_or_focus_app": "Only open, launch, activate, or focus one explicitly named macOS application. Example: mở Safari.",
                "read_screen": "Answer from what is currently on screen without touching anything. Examples: trên màn hình đang có gì; lỗi này nghĩa là gì; tóm tắt trang đang mở; dịch đoạn này; biểu đồ này nói gì.",
                "general": "Interact with a browser, website, window, dialog, or control. Examples: open Safari rồi vào GitHub; bấm nút gửi; gửi tin nhắn bằng trình duyệt; thanh toán hoá đơn.",
                "none": "Not a computer-use request."
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
                "codex.run_benchmark": "Run, measure, bench, or đo Tibo's benchmark. Examples: bench hiệu năng phân loại; đo benchmark tiếng việt.",
                "eva.run_evaluation": "Validate, inspect, or run the local Eva evaluation. Examples: kiểm tra bộ dữ liệu eva; validate eva.",
                "omp.delete_all_sessions": "Delete, clear, purge, dọn sạch, or remove all OMP sessions/history.",
                "memory.remember": format!("Ask {name} to remember a fact about the user. Examples: nhớ là tôi thích trả lời ngắn; ghi nhớ giúp tôi là mai họp 9 giờ."),
                "memory.recall": format!("Ask what {name} remembers about the user. Examples: bạn nhớ gì về tôi; {name} biết gì về tôi."),
                "memory.forget": format!("Ask {name} to forget a remembered fact or everything. Examples: quên chuyện cà phê đi; quên hết."),
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
            "instructions": "Score the highest plausible consequence, not just the grammatical tone. Always choose level 2 for sending or submitting content, changing settings or files, purchases or payments, credentials or secrets, deletion, production changes, pushing to a shared remote or main branch, force push or rewriting git history, or any irreversible action.",
            "criteria": [
                "Read-only or informational",
                "Reversible local state change with no external submission",
                "Side-effect-capable or irreversible: send/submit, settings/files, purchase/payment, credentials/secrets, delete, production, or data loss"
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

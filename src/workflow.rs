//! Assistant workflows: `<data>/workflows/*.md`, seeded from `workflows/` on first use and
//! hand-editable afterwards. A file is
//!
//! ```text
//! # Name
//! triggers: phrase | phrase | ...
//! confirm: yes            (optional: acts on the Mac/web, so it waits for "xác nhận")
//! ---
//! instructions for the agent ({mac} = the bundled macOS helper)
//! ```
//!
//! A chat turn whose text contains a trigger (accents/case folded, whole words) runs the agent with
//! bash and these instructions. `TIBO_WORKFLOWS_DIR` overrides the directory.
use crate::{memory, policy::normalize, session};
use std::{env, fs, path::PathBuf};

const DEFAULTS: &[(&str, &str)] = &[
    ("ban-tin.md", include_str!("../workflows/ban-tin.md")),
    ("nhac-viec.md", include_str!("../workflows/nhac-viec.md")),
    ("lich.md", include_str!("../workflows/lich.md")),
    ("ghi-chu.md", include_str!("../workflows/ghi-chu.md")),
    ("hen-gio.md", include_str!("../workflows/hen-gio.md")),
    ("thoi-tiet.md", include_str!("../workflows/thoi-tiet.md")),
    ("soan-thu.md", include_str!("../workflows/soan-thu.md")),
    ("trinh-duyet.md", include_str!("../workflows/trinh-duyet.md")),
    ("clipboard.md", include_str!("../workflows/clipboard.md")),
];
const MAC_JS: &str = include_str!("../workflows/mac.js");
const WEEKDAYS: [&str; 7] = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

#[derive(Debug, Clone, PartialEq)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub triggers: Vec<String>,
    pub body: String,
    /// Acting workflow: needs the user's approval before it runs.
    pub confirm: bool,
}

pub fn dir() -> PathBuf {
    env::var_os("TIBO_WORKFLOWS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| session::data_dir().join("workflows"))
}

/// Seeds the templates only when the directory is new, so deleting one disables it for good;
/// `mac.js` is code, not a template, and always tracks this build.
/// ponytail: edited templates never receive upstream updates; add a version stamp if that bites.
fn ensure_dir() -> PathBuf {
    let dir = dir();
    if !dir.is_dir() && fs::create_dir_all(&dir).is_ok() {
        for (name, text) in DEFAULTS {
            let _ = fs::write(dir.join(name), text);
        }
    }
    if fs::read_to_string(dir.join("mac.js")).ok().as_deref() != Some(MAC_JS) {
        let _ = fs::write(dir.join("mac.js"), MAC_JS);
    }
    dir
}

pub fn parse(id: &str, text: &str) -> Option<Workflow> {
    let (head, body) = text.split_once("\n---\n")?;
    let mut name = None;
    let mut triggers = Vec::new();
    let mut confirm = false;
    for line in head.lines() {
        if let Some(title) = line.strip_prefix("# ") {
            name = Some(title.trim().to_string());
        } else if let Some(list) = line.strip_prefix("triggers:") {
            triggers = list.split('|').map(normalize).filter(|t| !t.is_empty()).collect();
        } else if let Some(value) = line.strip_prefix("confirm:") {
            confirm = matches!(value.trim(), "yes" | "true" | "có");
        }
    }
    (!triggers.is_empty()).then(|| Workflow {
        id: id.into(),
        name: name.unwrap_or_else(|| id.into()),
        triggers,
        body: body.trim().into(),
        confirm,
    })
}

pub fn load() -> Vec<Workflow> {
    let Ok(entries) = fs::read_dir(ensure_dir()) else { return Vec::new() };
    let mut workflows: Vec<Workflow> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_stem()?.to_str()?.to_string();
            (path.extension()? == "md").then_some(())?;
            parse(&id, &fs::read_to_string(&path).ok()?)
        })
        .collect();
    workflows.sort_by(|a, b| a.id.cmp(&b.id));
    workflows
}

/// The workflow whose trigger appears earliest in `transcript` (whole words), longest on a tie:
/// the request usually leads, so "hẹn giờ 5 phút nhắc tôi uống nước" is a timer, not a reminder.
/// Punctuation counts as a word break ("trên youtube." still matches "trên youtube").
pub fn find<'a>(workflows: &'a [Workflow], transcript: &str) -> Option<&'a Workflow> {
    let words: String = normalize(transcript).chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    let text = format!(" {} ", words.split_whitespace().collect::<Vec<_>>().join(" "));
    let text = text.as_str();
    workflows
        .iter()
        .flat_map(|workflow| {
            workflow.triggers.iter().filter_map(move |trigger| {
                let at = text.find(&format!(" {trigger} "))?;
                Some(((std::cmp::Reverse(at), trigger.len()), workflow))
            })
        })
        .max_by_key(|(key, _)| *key)
        .map(|(_, workflow)| workflow)
}

/// Instructions appended to the agent's system prompt for this turn.
pub fn instructions(workflow: &Workflow, now: memory::Now) -> String {
    let mac = format!("osascript -l JavaScript '{}'", dir().join("mac.js").display());
    let stamp = now.rfc3339();
    let weekday = WEEKDAYS[((now.epoch + now.offset).div_euclid(86_400) + 4).rem_euclid(7) as usize];
    format!(
        "Quy trình \"{}\": lượt này bạn được dùng công cụ bash để làm đúng việc dưới đây rồi mới trả lời. Chỉ chạy các lệnh quy trình cho phép; nếu lệnh lỗi thì nói ngắn gọn điều gì chưa được, đừng bịa kết quả. Mọi chữ bạn viết đều bị đọc to, nên không viết gì trước hay giữa các lần chạy lệnh; chỉ viết một câu trả lời cuối bằng tiếng Việt: một hai câu, không đọc lệnh hay đường dẫn.\nBây giờ: {weekday}, {}.\n\n{}",
        workflow.name,
        &stamp[..16].replace('T', " "),
        workflow.body.replace("{mac}", &mac)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> Vec<Workflow> {
        DEFAULTS
            .iter()
            .map(|(name, text)| parse(name.trim_end_matches(".md"), text).expect(name))
            .collect()
    }

    #[test]
    fn routes_everyday_requests_to_the_right_workflow() {
        let all = defaults();
        for (said, id) in [
            ("Tibo ơi nhắc tôi 8 giờ tối gọi mẹ", "nhac-viec"),
            ("hẹn giờ 10 phút", "hen-gio"),
            ("Ngày mai trời có mưa không", "thoi-tiet"),
            ("hôm nay tôi có gì", "ban-tin"),
            ("xem lịch hôm nay", "lich"),
            ("hẹn giờ 5 phút nhắc tôi uống nước", "hen-gio"),
            ("thêm lịch họp với Nam 3 giờ chiều mai", "lich"),
            ("ghi chú lại danh sách đi chợ: trứng, sữa", "ghi-chu"),
            ("soạn email xin nghỉ phép gửi sếp", "soan-thu"),
            ("dịch đoạn tôi vừa copy sang tiếng Anh", "clipboard"),
            ("tìm trên youtube bài Lạc Trôi", "trinh-duyet"),
            ("mở trang vnexpress xem tin mới", "trinh-duyet"),
            ("Bật nhạc Sơn Tùng trên Youtube.", "trinh-duyet"),
            ("tìm kiếm web về trí tuệ nhân tạo", "trinh-duyet"),
            ("truy cập Wikipedia đọc bài trí tuệ nhân tạo", "trinh-duyet"),
            ("mở link này trong Chrome", "trinh-duyet"),
        ] {
            assert_eq!(find(&all, said).map(|w| w.id.as_str()), Some(id), "{said}");
        }
    }

    #[test]
    fn only_the_browser_workflow_needs_approval() {
        let acting: Vec<String> = defaults().into_iter().filter(|w| w.confirm).map(|w| w.id).collect();
        assert_eq!(acting, ["trinh-duyet"]);
    }

    #[test]
    fn plain_chat_and_partial_words_do_not_trigger() {
        let all = defaults();
        for said in ["Docker là gì", "kể chuyện cười đi", "lịch sử Việt Nam thế nào", "thời tiếtabc"] {
            assert_eq!(find(&all, said).map(|w| w.id.as_str()), None, "{said}");
        }
    }

    #[test]
    fn instructions_carry_local_weekday_and_helper_path() {
        let workflow = parse("x", "# X\ntriggers: a\n---\nrun {mac} timer 5").unwrap();
        // 01:00 Monday in Vietnam is still Sunday in UTC.
        let (epoch, offset) = memory::parse_rfc3339("2026-09-28T01:00:00+07:00").unwrap();
        let text = instructions(&workflow, memory::Now { epoch, offset });
        assert!(text.contains("Bây giờ: Thứ hai, 2026-09-28 01:00."), "{text}");
        assert!(text.contains("osascript -l JavaScript '") && text.contains("mac.js' timer 5"), "{text}");
    }
}

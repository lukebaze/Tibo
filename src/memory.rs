//! Tibo's own memory, independent of the agent harness: plain files in `dir()`.
//! - `turns/YYYY-MM-DD.jsonl`: append-only turn log (`LoggedTurn` per line).
//! - `facts.md`: `- <fact> (YYYY-MM-DD)[ (user)]` bullets, ≤ `FACTS_MAX` chars, hand-editable.
//! - `days.md`: `YYYY-MM-DD: <summary>` lines, newest last, ≤ `DAYS_KEEP` lines.
//! Every write goes through `redact_secrets`. `TIBO_MEMORY_DIR` overrides the directory and
//! `TIBO_MEMORY_NOW` (RFC 3339) overrides the clock, for tests and smoke runs.
use crate::{policy::normalize, profile};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, Read, Write},
    os::unix::{
        fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const FACTS_MAX: usize = 1500;
const DAYS_KEEP: usize = 30;
const CONTEXT_MAX: usize = 3000;
const DAYS_IN_CONTEXT: usize = 7;
const DAYS_CONTEXT_MAX: usize = 700;
const TURNS_CONTEXT_MAX: usize = 1000;
const RECENT_TURNS: usize = 6;
const RECENT_WINDOW_SECS: i64 = 15 * 60;
const DAY_LOG_MAX: usize = 8000;
const TURN_TEXT_MAX: usize = 2000;
const CONSOLIDATE_TIMEOUT: Duration = Duration::from_secs(180);
/// A lock older than this belongs to a crashed consolidation; the next turn may retry.
const LOCK_STALE: Duration = Duration::from_secs(15 * 60);
const REDACTED: &str = "[đã ẩn]";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggedTurn {
    pub t: String,
    pub user: String,
    pub tibo: String,
    pub route: String,
}

/// What the consolidation agent must return.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct Consolidation {
    pub day: String,
    pub add: Vec<String>,
    pub drop: Vec<String>,
}

pub fn dir() -> PathBuf {
    env::var_os("TIBO_MEMORY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::session::data_dir().join("memory"))
}

pub fn enabled() -> bool {
    profile::load().memory_enabled
}

pub fn read_facts() -> String {
    read("facts.md")
}

fn read(name: &str) -> String {
    fs::read_to_string(dir().join(name)).unwrap_or_default()
}

// ---- clock -------------------------------------------------------------------------------------

/// Wall clock plus the local UTC offset, so turn stamps and day boundaries are local time.
#[derive(Debug, Clone, Copy)]
pub struct Now {
    pub epoch: i64,
    pub offset: i64,
}

impl Now {
    pub fn get() -> Self {
        if let Some((epoch, offset)) = env::var("TIBO_MEMORY_NOW").ok().and_then(|v| parse_rfc3339(&v)) {
            return Self { epoch, offset };
        }
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        let offset = Command::new("/bin/date")
            .arg("+%z")
            .output()
            .ok()
            .and_then(|out| parse_offset(String::from_utf8_lossy(&out.stdout).trim()))
            .unwrap_or(0);
        Self { epoch, offset }
    }

    pub fn rfc3339(self) -> String {
        format_rfc3339(self.epoch, self.offset)
    }

    pub fn day(self) -> String {
        self.rfc3339()[..10].to_string()
    }
}

fn parse_offset(text: &str) -> Option<i64> {
    if text == "Z" {
        return Some(0);
    }
    let sign = match text.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let digits: String = text[1..].chars().filter(|c| *c != ':').collect();
    if digits.len() != 4 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(sign * (digits[..2].parse::<i64>().ok()? * 3600 + digits[2..].parse::<i64>().ok()? * 60))
}

fn format_rfc3339(epoch: i64, offset: i64) -> String {
    let local = epoch + offset;
    let (year, month, day) = civil_from_days(local.div_euclid(86_400));
    let secs = local.rem_euclid(86_400);
    let sign = if offset < 0 { '-' } else { '+' };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}{sign}{:02}:{:02}",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60,
        offset.abs() / 3600,
        offset.abs() % 3600 / 60
    )
}

/// `YYYY-MM-DDTHH:MM:SS±HH:MM` → (unix seconds, offset seconds).
pub fn parse_rfc3339(text: &str) -> Option<(i64, i64)> {
    let num = |from: usize, to: usize| text.get(from..to)?.parse::<i64>().ok();
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let offset = parse_offset(text.get(19..)?)?;
    Some((
        days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offset,
        offset,
    ))
}

// Howard Hinnant's civil calendar conversions (proleptic Gregorian, day 0 = 1970-01-01).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

// ---- files -------------------------------------------------------------------------------------

fn ensure_dir(path: &Path) -> io::Result<()> {
    fs::DirBuilder::new().recursive(true).mode(0o700).create(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

fn write_private(path: &Path, text: &str) -> io::Result<()> {
    ensure_dir(path.parent().unwrap_or(Path::new(".")))?;
    let tmp = path.with_extension("tmp");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(text.as_bytes())?;
    fs::rename(tmp, path)
}

fn turn_files() -> Vec<(String, PathBuf)> {
    let mut files: Vec<(String, PathBuf)> = fs::read_dir(dir().join("turns"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let day = path.file_name()?.to_str()?.strip_suffix(".jsonl")?.to_string();
            (day.len() == 10).then_some((day, path))
        })
        .collect();
    files.sort();
    files
}

fn read_turns(path: &Path) -> Vec<LoggedTurn> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

// ---- guards ------------------------------------------------------------------------------------

/// Replaces API keys and tokens (`sk-`, `ghp_`, `xoxb-`/`xoxp-`, JWT `eyJ`, `AKIA`) with `[đã ẩn]`.
pub fn redact_secrets(text: &str) -> String {
    const PATTERNS: [(&str, usize); 6] =
        [("sk-", 16), ("ghp_", 20), ("xoxb-", 10), ("xoxp-", 10), ("eyJ", 20), ("AKIA", 16)];
    let token = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.');
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if i == 0 || !token(bytes[i - 1]) {
            if let Some((prefix, min)) = PATTERNS.iter().find(|(p, _)| text[i..].starts_with(p)) {
                let body = bytes[i + prefix.len()..].iter().take_while(|b| token(**b)).count();
                if body >= *min {
                    out.push_str(REDACTED);
                    i += prefix.len() + body;
                    continue;
                }
            }
        }
        let ch = text[i..].chars().next().unwrap_or_default();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

// ---- per-turn log ------------------------------------------------------------------------------

/// Appends one turn to today's log; a no-op when memory is off or Tibo said nothing.
pub fn log_turn(user: &str, tibo: &str, route: &str) {
    if tibo.trim().is_empty() || !enabled() {
        return;
    }
    let now = Now::get();
    let entry = LoggedTurn {
        t: now.rfc3339(),
        user: clip(&redact_secrets(user.trim()), TURN_TEXT_MAX),
        tibo: clip(&redact_secrets(tibo.trim()), TURN_TEXT_MAX),
        route: route.into(),
    };
    if let Err(error) = append_turn(&now.day(), &entry) {
        eprintln!("TIBO_MEMORY log_failed {error}");
    }
}

fn append_turn(day: &str, entry: &LoggedTurn) -> io::Result<()> {
    let turns = dir().join("turns");
    ensure_dir(&dir())?;
    ensure_dir(&turns)?;
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(turns.join(format!("{day}.jsonl")))?
        .write_all(line.as_bytes())
}

/// Up to `RECENT_TURNS` latest turns, only while the conversation is fresh (last turn < 15 min ago).
pub fn recent_turns(now: Now) -> Vec<LoggedTurn> {
    if !enabled() {
        return Vec::new();
    }
    let files = turn_files();
    // The last two log files cover a conversation that crosses midnight.
    let mut turns: Vec<LoggedTurn> = files[files.len().saturating_sub(2)..]
        .iter()
        .flat_map(|(_, path)| read_turns(path))
        .collect();
    let fresh = turns
        .last()
        .and_then(|turn| parse_rfc3339(&turn.t))
        .is_some_and(|(epoch, _)| now.epoch - epoch < RECENT_WINDOW_SECS);
    if !fresh {
        return Vec::new();
    }
    turns.drain(..turns.len().saturating_sub(RECENT_TURNS));
    turns
}

pub fn format_turn(turn: &LoggedTurn) -> String {
    format!("Người dùng: {}\nTibo: {}", turn.user, turn.tibo)
}

// ---- context -----------------------------------------------------------------------------------

/// Memory block appended to the end of the agent's system prompt; empty when memory is off.
pub fn context(recent: &[LoggedTurn]) -> String {
    if !enabled() {
        return String::new();
    }
    build_context(&read_facts(), &read("days.md"), recent)
}

/// Stable parts first (facts, then days, then the live conversation) so provider prompt caches
/// keep hitting on the prefix. Each part has its own budget and the whole block ≤ `CONTEXT_MAX`.
pub fn build_context(facts: &str, days: &str, recent: &[LoggedTurn]) -> String {
    let mut out = String::new();
    let push = |out: &mut String, header: &str, body: String| {
        if body.is_empty() {
            return;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(header);
        out.push('\n');
        out.push_str(&body);
    };
    let fact_lines: Vec<&str> = facts.lines().filter(|l| !l.trim().is_empty()).collect();
    push(&mut out, "Điều bạn biết về người dùng:", keep_oldest(&fact_lines, FACTS_MAX, "\n"));
    let day_lines: Vec<&str> = days.lines().filter(|l| !l.trim().is_empty()).collect();
    let day_lines = &day_lines[day_lines.len().saturating_sub(DAYS_IN_CONTEXT)..];
    push(&mut out, "Mấy ngày gần đây:", keep_newest(day_lines, DAYS_CONTEXT_MAX, "\n"));
    const TURNS_HEADER: &str = "Cuộc trò chuyện vừa rồi:";
    let room = CONTEXT_MAX.saturating_sub(chars(&out) + 2 + chars(TURNS_HEADER) + 1);
    let turns: Vec<String> = recent.iter().map(format_turn).collect();
    let turns: Vec<&str> = turns.iter().map(String::as_str).collect();
    push(&mut out, TURNS_HEADER, keep_newest(&turns, TURNS_CONTEXT_MAX.min(room), "\n"));
    out
}

/// Longest prefix of whole items within `max` chars.
fn keep_oldest(items: &[&str], max: usize, sep: &str) -> String {
    let mut out = String::new();
    for item in items {
        let extra = if out.is_empty() { 0 } else { chars(sep) };
        if chars(&out) + extra + chars(item) > max {
            break;
        }
        if extra > 0 {
            out.push_str(sep);
        }
        out.push_str(item);
    }
    out
}

/// Longest suffix of whole items within `max` chars; a lone oversized newest item is clipped.
fn keep_newest(items: &[&str], max: usize, sep: &str) -> String {
    let mut start = items.len();
    let mut used = 0;
    while start > 0 {
        let extra = if start == items.len() { 0 } else { chars(sep) };
        if used + extra + chars(items[start - 1]) > max {
            break;
        }
        used += extra + chars(items[start - 1]);
        start -= 1;
    }
    if start == items.len() {
        return items.last().map(|item| clip(item, max)).unwrap_or_default();
    }
    items[start..].join(sep)
}

// ---- facts -------------------------------------------------------------------------------------

fn is_user(line: &str) -> bool {
    line.trim_end().ends_with("(user)")
}

/// The fact text of a `- <fact> (YYYY-MM-DD)[ (user)]` bullet, without date or marker.
fn fact_text(line: &str) -> Option<&str> {
    let text = line.trim().strip_prefix("- ")?;
    let text = text.strip_suffix("(user)").unwrap_or(text).trim_end();
    Some(match text.strip_suffix(')').and_then(|t| t.rsplit_once(" (")) {
        Some((fact, day)) if is_day(day) => fact.trim_end(),
        _ => text,
    })
}

fn fact_day(line: &str) -> &str {
    let text = line.trim();
    let text = text.strip_suffix("(user)").unwrap_or(text).trim_end();
    match text.strip_suffix(')').and_then(|t| t.rsplit_once(" (")) {
        Some((_, day)) if is_day(day) => day,
        _ => "",
    }
}

fn is_day(text: &str) -> bool {
    text.len() == 10
        && text
            .bytes()
            .enumerate()
            .all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
}

fn clean_fact(fact: &str) -> String {
    let fact = one_line(&redact_secrets(fact));
    let fact = fact
        .trim()
        .trim_start_matches("- ")
        .trim_matches(|c: char| matches!(c, '.' | ',' | ';' | ':' | '!' | '"' | '“' | '”'))
        .trim();
    clip(fact, 200)
}

/// Adds `- fact (day)[ (user)]` unless an equal fact (accents/case folded) is already listed.
fn push_fact(lines: &mut Vec<String>, fact: &str, day: &str, user: bool) -> bool {
    let fact = clean_fact(fact);
    let key = normalize(&fact);
    if key.is_empty() || lines.iter().any(|line| fact_text(line).is_some_and(|t| normalize(t) == key)) {
        return false;
    }
    lines.push(format!("- {fact} ({day}){}", if user { " (user)" } else { "" }));
    true
}

fn join_lines(lines: &[String]) -> String {
    if lines.is_empty() {
        String::new()
    } else {
        lines.join("\n") + "\n"
    }
}

/// Drops the oldest non-`(user)` lines until the file fits `FACTS_MAX`; returns how many went.
fn enforce_cap(lines: &mut Vec<String>) -> usize {
    let mut dropped = 0;
    while chars(&join_lines(lines)) > FACTS_MAX {
        let Some(index) = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| !is_user(line))
            .min_by_key(|(index, line)| (fact_day(line), *index))
            .map(|(index, _)| index)
        else {
            break;
        };
        lines.remove(index);
        dropped += 1;
    }
    dropped
}

/// Applies a consolidation result: replaces the day's summary line, drops the listed facts except
/// `(user)` ones, adds new facts dated `day` without duplicates, then enforces `FACTS_MAX`.
/// Returns (facts.md, days.md, added, dropped).
pub fn apply_consolidation(
    facts: &str,
    days: &str,
    day: &str,
    result: &Consolidation,
) -> (String, String, usize, usize) {
    let prefix = format!("{day}:");
    let mut day_lines: Vec<String> = days
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with(&prefix))
        .map(String::from)
        .collect();
    day_lines.push(format!("{prefix} {}", clip(&one_line(&redact_secrets(&result.day)), 200)));
    day_lines.drain(..day_lines.len().saturating_sub(DAYS_KEEP));

    let mut lines: Vec<String> = facts.lines().map(String::from).collect();
    let before = lines.len();
    let same = |line: &str, drop: &str| {
        line.trim().trim_start_matches("- ") == drop.trim().trim_start_matches("- ")
    };
    lines.retain(|line| is_user(line) || !result.drop.iter().any(|drop| same(line, drop)));
    let mut dropped = before - lines.len();
    let added = result.add.iter().filter(|fact| push_fact(&mut lines, fact, day, false)).count();
    dropped += enforce_cap(&mut lines);
    (join_lines(&lines), join_lines(&day_lines), added, dropped)
}

/// "tôi" → "bạn" so a fact the user dictated reads back naturally.
pub fn spoken_fact(line: &str) -> String {
    fact_text(line)
        .unwrap_or(line)
        .split_whitespace()
        .map(|word| match normalize(word).trim_matches(|c: char| !c.is_alphanumeric()) {
            "toi" if word.starts_with('T') => word.replacen("Tôi", "Bạn", 1),
            "toi" => word.replacen("tôi", "bạn", 1),
            _ => word.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `memory.remember`: stores a `(user)` fact.
pub fn remember(fact: &str) -> (&'static str, String) {
    if !enabled() {
        return ("failed", "Trí nhớ đang tắt trong Cài đặt.".into());
    }
    let mut lines: Vec<String> = read_facts().lines().map(String::from).collect();
    let cleaned = clean_fact(fact);
    push_fact(&mut lines, &cleaned, &Now::get().day(), true);
    enforce_cap(&mut lines);
    if chars(&join_lines(&lines)) > FACTS_MAX {
        return ("failed", "Trí nhớ đầy rồi, bạn bảo mình quên bớt nhé.".into());
    }
    match write_private(&dir().join("facts.md"), &join_lines(&lines)) {
        Ok(()) => ("succeeded", format!("Mình nhớ rồi: {}.", spoken_fact(&format!("- {cleaned}")))),
        Err(error) => ("failed", format!("Không ghi được trí nhớ: {error}")),
    }
}

/// `memory.recall`: at most two sentences, newest facts first.
pub fn recall() -> String {
    let facts = read_facts();
    let items: Vec<String> = facts.lines().rev().filter(|l| fact_text(l).is_some()).map(spoken_fact).collect();
    match items.as_slice() {
        [] => "Mình chưa nhớ gì về bạn.".into(),
        [one] => format!("Mình nhớ là {one}."),
        [first, second, ..] => format!(
            "Mình nhớ {} điều về bạn. Gần đây nhất là {first}, và {second}.",
            items.len()
        ),
    }
}

/// `memory.forget`: the facts line sharing the most words with `query` (newest wins a tie).
pub fn best_match(facts: &str, query: &str) -> Option<String> {
    const STOP: [&str; 10] = ["toi", "la", "cua", "va", "cai", "chuyen", "viec", "ve", "minh", "ban"];
    let words = |text: &str| -> Vec<String> {
        normalize(text)
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty() && !STOP.contains(w))
            .map(String::from)
            .collect()
    };
    let wanted = words(query);
    facts
        .lines()
        .filter_map(|line| {
            let have = words(fact_text(line)?);
            let score = wanted.iter().filter(|w| have.contains(w)).count();
            (score > 0).then_some((score, line))
        })
        .fold(None::<(usize, &str)>, |best, (score, line)| match best {
            Some((top, _)) if top > score => best,
            _ => Some((score, line)),
        })
        .map(|(_, line)| line.to_string())
}

/// Confirmed forget: one exact facts line, or (`None`) the whole memory.
pub fn forget(line: Option<&str>) -> (&'static str, String) {
    let root = dir();
    let Some(line) = line else {
        let _ = fs::remove_dir_all(root.join("turns"));
        let _ = fs::remove_file(root.join("facts.md"));
        let _ = fs::remove_file(root.join("days.md"));
        return ("succeeded", "Mình đã quên hết rồi.".into());
    };
    let facts = read_facts();
    let kept: Vec<String> = facts.lines().filter(|l| *l != line).map(String::from).collect();
    if kept.len() == facts.lines().count() {
        return ("failed", "Điều đó không còn trong trí nhớ.".into());
    }
    match write_private(&root.join("facts.md"), &join_lines(&kept)) {
        Ok(()) => ("succeeded", format!("Mình đã quên: {}.", spoken_fact(line))),
        Err(error) => ("failed", format!("Không ghi được trí nhớ: {error}")),
    }
}

// ---- daily consolidation -----------------------------------------------------------------------

fn lock_path(day: &str) -> PathBuf {
    dir().join(format!(".consolidating-{day}"))
}

/// First turn of a new day: if the latest logged day before today has no `days.md` line, run
/// `tibo --consolidate-memory <day>` detached so the current turn never waits on it. The lock file
/// keeps later turns from starting a duplicate; it is removed when the run ends, so a failed run is
/// retried on the next turn.
pub fn maybe_consolidate(now: Now) {
    if !enabled() {
        return;
    }
    let today = now.day();
    let Some(day) = turn_files().into_iter().map(|(day, _)| day).filter(|day| *day < today).last()
    else {
        return;
    };
    if read("days.md").lines().any(|line| line.starts_with(&format!("{day}:"))) {
        return;
    }
    let lock = lock_path(&day);
    let stale = lock
        .metadata()
        .and_then(|meta| meta.modified())
        .is_ok_and(|at| at.elapsed().unwrap_or_default() > LOCK_STALE);
    if stale {
        let _ = fs::remove_file(&lock);
    }
    if fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&lock).is_err() {
        return;
    }
    let spawned = (|| -> io::Result<()> {
        let log = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .open(dir().join("consolidate.log"))?;
        Command::new(env::current_exe()?)
            .args(["--consolidate-memory", &day])
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .process_group(0)
            .spawn()
            .map(drop)
    })();
    match spawned {
        Ok(()) => eprintln!("TIBO_MEMORY consolidate_start day={day}"),
        Err(error) => {
            let _ = fs::remove_file(&lock);
            eprintln!("TIBO_MEMORY consolidate_spawn_failed {error}");
        }
    }
}

/// Body of `tibo --consolidate-memory <day>`; any failure leaves the files untouched.
pub fn consolidate(day: &str) -> Result<(), String> {
    let result = consolidate_day(day);
    let _ = fs::remove_file(lock_path(day));
    if let Err(error) = &result {
        println!("TIBO_MEMORY consolidate_failed day={day} {error}");
    }
    result
}

fn consolidate_day(day: &str) -> Result<(), String> {
    if !is_day(day) {
        return Err(format!("invalid day {day:?}"));
    }
    let turns = read_turns(&dir().join("turns").join(format!("{day}.jsonl")));
    if turns.is_empty() {
        return Err("no turns".into());
    }
    let log: String = turns
        .iter()
        .map(|turn| format!("[{}] {}\n", turn.t.get(11..16).unwrap_or(""), format_turn(turn)))
        .collect();
    let log: String = log.chars().skip(chars(&log).saturating_sub(DAY_LOG_MAX)).collect();
    let facts = read_facts();
    let system = "Bạn gom nhật ký một ngày trò chuyện giữa người dùng và trợ lý giọng nói Tibo thành trí nhớ dài hạn. Chỉ trả về đúng một JSON object, không thêm chữ nào khác: {\"day\":\"tóm tắt ngày, tối đa 200 ký tự\",\"add\":[\"điều mới đáng nhớ lâu dài về người dùng\"],\"drop\":[\"nguyên văn dòng trong facts.md đã sai hoặc lỗi thời\"]}. add chỉ gồm sở thích, thói quen, thông tin cá nhân, dự án, quyết định có giá trị lâu dài; mỗi mục một câu ngắn tiếng Việt, không trùng facts.md, không ghi mật khẩu, khoá hay bí mật; không thêm lại điều người dùng đã bảo quên. drop chỉ chép nguyên văn dòng có trong facts.md; không bỏ dòng có (user). Không có gì thì để mảng rỗng.";
    let prompt = format!(
        "Ngày: {day}\n\nfacts.md hiện tại:\n{}\n\nNhật ký ngày {day}:\n{log}",
        if facts.trim().is_empty() { "(trống)" } else { facts.trim() }
    );
    let output = run_agent(system, &prompt)?;
    let json = output
        .find('{')
        .zip(output.rfind('}'))
        .and_then(|(start, end)| output.get(start..=end))
        .ok_or("agent returned no JSON")?;
    let result: Consolidation = serde_json::from_str(json).map_err(|e| format!("bad JSON: {e}"))?;
    if result.day.trim().is_empty() {
        return Err("empty day summary".into());
    }
    // Re-read: the user may have said "nhớ là…" while the agent was thinking.
    let (facts, days, added, dropped) =
        apply_consolidation(&read_facts(), &read("days.md"), day, &result);
    write_private(&dir().join("facts.md"), &facts).map_err(|e| e.to_string())?;
    write_private(&dir().join("days.md"), &days).map_err(|e| e.to_string())?;
    println!("TIBO_MEMORY consolidated day={day} add={added} drop={dropped}");
    Ok(())
}

/// One-shot, tool-less run of the brain chosen in the profile (same flags as the app's
/// `startAgent`, text output). `TIBO_<AGENT>` overrides the executable path.
fn run_agent(system: &str, prompt: &str) -> Result<String, String> {
    let profile = profile::load();
    let agent = if profile.agent.is_empty() { "pi" } else { profile.agent.as_str() };
    let path = search_path();
    let executable = env::var_os(format!("TIBO_{}", agent.to_uppercase()))
        .map(PathBuf::from)
        .or_else(|| {
            env::split_paths(&path)
                .map(|dir| dir.join(agent))
                .find(|file| file.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0))
        })
        .ok_or(format!("{agent} not found"))?;
    let mut command = Command::new(executable);
    match agent {
        "claude" => command.args([
            "-p", prompt, "--output-format", "text", "--setting-sources", "local",
            "--permission-mode", "plan", "--no-session-persistence", "--tools", "",
            "--system-prompt", system,
        ]),
        "omp" => command.args(["-p", "--no-tools", &format!("--system-prompt={system}"), prompt]),
        "pi" => {
            command.args(["-p", "--no-tools", "--system-prompt", system]);
            let model = profile.agent_model.trim();
            if !model.is_empty() {
                command.args(["--model", model]);
            }
            command.arg(prompt)
        }
        "codex" => command.args([
            "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
            &format!("{system}\n\n{prompt}"),
        ]),
        other => return Err(format!("unknown agent {other}")),
    };
    // Temp dir as cwd so the agent does not pick up a project's AGENTS.md/CLAUDE.md.
    let mut child = command
        .env("PATH", path)
        .current_dir(env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + CONSOLIDATE_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("agent timed out".into());
        }
        thread::sleep(Duration::from_millis(200));
    };
    let output = reader.join().unwrap_or_default();
    if status.success() {
        Ok(output)
    } else {
        Err(format!("agent exited with {status}"))
    }
}

/// Same directories as the app's `AgentCLI.searchPath`: Finder-launched apps get launchd's bare PATH.
fn search_path() -> std::ffi::OsString {
    let home = PathBuf::from(env::var_os("HOME").unwrap_or_else(|| "/tmp".into()));
    let mut dirs: Vec<PathBuf> = [".local/bin", "/opt/homebrew/bin", "/usr/local/bin", ".bun/bin", ".cargo/bin"]
        .iter()
        .map(|dir| home.join(dir))
        .collect();
    let mut nvm: Vec<PathBuf> = fs::read_dir(home.join(".nvm/versions/node"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    let version = |path: &PathBuf| -> Vec<u32> {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name.trim_start_matches('v').split('.').filter_map(|n| n.parse().ok()).collect()
    };
    nvm.sort_by_key(|path| std::cmp::Reverse(version(path)));
    dirs.extend(nvm.into_iter().map(|path| path.join("bin")));
    dirs.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(PathBuf::from));
    dirs.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
    env::join_paths(dirs).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(user: &str, tibo: &str) -> LoggedTurn {
        LoggedTurn { t: "2026-09-27T10:00:00+07:00".into(), user: user.into(), tibo: tibo.into(), route: "conversation".into() }
    }

    #[test]
    fn context_respects_part_and_total_budgets() {
        let facts: String = (0..60).map(|i| format!("- fact number {i:02} padded out (2026-09-01)\n")).collect();
        let days: String = (1..=20).map(|d| format!("2026-09-{d:02}: {}\n", "x".repeat(150))).collect();
        let recent: Vec<LoggedTurn> =
            (0..6).map(|i| turn(&format!("question {i}"), &"a".repeat(300))).collect();
        let context = build_context(&facts, &days, &recent);
        assert!(chars(&context) <= CONTEXT_MAX, "{}", chars(&context));
        let facts_part = context.split("\n\n").next().unwrap();
        assert!(chars(facts_part) <= FACTS_MAX + 40);
        assert!(context.contains("fact number 00"), "keeps the oldest (stable) facts");
        assert!(!context.contains("fact number 59"));
        assert!(!context.contains("2026-09-13:"), "only the last 7 days are eligible");
        assert!(context.contains("2026-09-20:") && !context.contains("2026-09-15:"), "≤700 chars keeps the newest");
        assert!(context.contains("question 5") && !context.contains("question 0"), "drops oldest turns first");

        let only_turns = build_context("", "\n", &recent[5..]);
        assert!(only_turns.starts_with("Cuộc trò chuyện vừa rồi:\nNgười dùng: question 5"));
        assert_eq!(build_context("", "", &[]), "");
    }

    #[test]
    fn secrets_are_redacted_but_words_are_not() {
        let text = "key sk-proj-abcdefghijklmnop123 gh ghp_ABCDEFGHIJKLMNOPQRSTUV12 slack xoxb-1234-56789-abc jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig aws AKIAABCDEFGHIJKLMNOP xong";
        assert_eq!(
            redact_secrets(text),
            "key [đã ẩn] gh [đã ẩn] slack [đã ẩn] jwt [đã ẩn] aws [đã ẩn] xong"
        );
        assert_eq!(redact_secrets("task-list ask-me sk-short Tiếng Việt"), "task-list ask-me sk-short Tiếng Việt");
    }

    #[test]
    fn consolidation_keeps_user_facts_dedupes_and_caps() {
        let facts = "- tôi thích trả lời ngắn (2026-09-01) (user)\n- dùng Rust (2026-09-02)\n- làm dự án Tibo (2026-09-03)\n";
        let result = Consolidation {
            day: "Làm memory cho Tibo.\nXong.".into(),
            add: vec!["Làm dự án TIBO".into(), "thích cà phê sữa".into(), "key sk-abcdefghijklmnopqrstu".into()],
            drop: vec!["- tôi thích trả lời ngắn (2026-09-01) (user)".into(), "- dùng Rust (2026-09-02)".into()],
        };
        let days: String = (1..=30).map(|d| format!("2026-08-{d:02}: cũ\n")).collect();
        let (facts, days, added, dropped) = apply_consolidation(facts, &days, "2026-09-27", &result);
        assert!(facts.contains("tôi thích trả lời ngắn (2026-09-01) (user)"), "(user) survives drop");
        assert!(!facts.contains("dùng Rust"));
        assert_eq!(facts.matches("dự án").count(), 1, "accent/case-insensitive dedupe");
        assert!(facts.contains("- thích cà phê sữa (2026-09-27)\n"));
        assert!(facts.contains("[đã ẩn]") && !facts.contains("sk-abc"));
        assert_eq!((added, dropped), (2, 1));
        assert_eq!(days.lines().count(), 30);
        assert!(days.ends_with("2026-09-27: Làm memory cho Tibo. Xong.\n"));
        assert!(!days.contains("2026-08-01:"));

        let mut big: String = (0..40)
            .map(|i| format!("- old fact {i:02} {} (2026-08-{:02})\n", "p".repeat(30), i % 28 + 1))
            .collect();
        big.push_str("- user fact (2026-08-01) (user)\n");
        let result = Consolidation { day: "d".into(), add: vec!["brand new".into()], ..Default::default() };
        let (facts, _, _, dropped) = apply_consolidation(&big, "", "2026-09-27", &result);
        assert!(chars(&facts) <= FACTS_MAX && dropped > 0);
        assert!(facts.contains("user fact") && facts.contains("brand new"));
        assert!(!facts.contains("old fact 00"), "oldest dated line goes first");
    }

    #[test]
    fn forget_picks_line_with_most_shared_words() {
        let facts = "- tôi thích cà phê đen (2026-09-01) (user)\n- tôi thích trà sữa (2026-09-02)\n- làm dự án Tibo (2026-09-03)\n";
        assert_eq!(best_match(facts, "cà phê").as_deref(), Some("- tôi thích cà phê đen (2026-09-01) (user)"));
        assert_eq!(best_match(facts, "thích trà sữa").as_deref(), Some("- tôi thích trà sữa (2026-09-02)"));
        assert_eq!(best_match(facts, "chuyện của tôi"), None, "stop words alone never match");
        assert_eq!(spoken_fact("- Tôi thích cà phê, tôi uống (2026-09-01) (user)"), "Bạn thích cà phê, bạn uống");
    }

    #[test]
    fn rfc3339_round_trips_local_time() {
        let (epoch, offset) = parse_rfc3339("2026-03-01T00:30:05+07:00").unwrap();
        assert_eq!(format_rfc3339(epoch, offset), "2026-03-01T00:30:05+07:00");
        assert_eq!(format_rfc3339(epoch, 0), "2026-02-28T17:30:05+00:00");
    }
}

use graviz::{jev::JevClient, policy::{self, Decision, PendingAction, SessionAction}, questions::{self, SessionSnapshot, Thresholds, Turn}};
use std::{env, fs, process::ExitCode, time::Instant};

#[derive(Debug)]
struct Case {
    id: String, transcript: String, wake: bool, active: bool, interrupted: bool,
    route: String, action: String, closed: String, agent: String, risk_min: f64,
}

fn main() -> ExitCode {
    match run() { Ok(true) => ExitCode::SUCCESS, Ok(false) => ExitCode::FAILURE, Err(error) => { eprintln!("BENCH_ERROR {error}"); ExitCode::FAILURE } }
}

fn run() -> Result<bool, String> {
    let mut quick = false;
    let mut record = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--quick" => quick = true,
            "--record" => record = Some(args.next().ok_or("--record requires a path")?),
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if let Some(path) = record { env::set_var("GRAVIZ_JEV_RECORD", path); }
    let corpus = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/bench/vi_transcripts.tsv")).map_err(|e| e.to_string())?;
    let mut cases = parse(&corpus)?;
    if quick { cases.truncate(10); }
    let client = JevClient::from_env().map_err(|e| e.to_string())?;
    let mut correct = 0usize;
    let mut false_exec = 0usize;
    let mut clarified = 0usize;
    let mut latencies = Vec::new();
    let mut input_tokens = 0u64;
    println!("id\tok\tms\tdecision");
    for case in &cases {
        let pending = matches!(case.action.as_str(), "confirm" | "cancel").then(|| "pending action".into());
        let turn = Turn {
            transcript: case.transcript.clone(), wake_matched: case.wake, asr_language: "vi".into(), interrupted: case.interrupted,
            session: SessionSnapshot { active: case.active, agent: case.active.then(|| "codex".into()), task: case.active.then(|| "active benchmark task".into()), status: case.active.then(|| "running".into()), pending_confirmation: pending },
        };
        let started = Instant::now();
        let response = client.system_one_with_meta(&questions::build_state(&turn), &questions::questions()).map_err(|e| format!("{}: {e}", case.id))?;
        let latency = started.elapsed().as_millis() as u64;
        input_tokens += response.usage.input_tokens;
        let decision = policy::decide(&turn, &response.answers, &Thresholds::default());
        let ok = matches_case(case, &decision);
        if ok { correct += 1; }
        if unsafe_execution(case, &decision) { false_exec += 1; }
        if matches!(decision, Decision::Ignore { .. } | Decision::Incomplete | Decision::Clarify { .. }) { clarified += 1; }
        println!("{}\t{}\t{}\t{:?}", case.id, ok, latency, decision);
        latencies.push(latency);
    }
    latencies.sort_unstable();
    let total = cases.len().max(1);
    let accuracy = correct as f64 / total as f64;
    let false_rate = false_exec as f64 / total as f64;
    let clarify_rate = clarified as f64 / total as f64;
    let p50 = percentile(&latencies, 0.50);
    let p95 = percentile(&latencies, 0.95);
    let cost = input_tokens as f64 * 42e-9;
    let summary = format!("BENCH_SUMMARY accuracy={:.2}% false_exec={:.2}% clarify={:.2}% p50_ms={} p95_ms={} cost_usd={:.6}", accuracy * 100.0, false_rate * 100.0, clarify_rate * 100.0, p50, p95, cost);
    println!("{summary}");
    fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/bench/RESULTS.md"), format!("# Graviz Jev benchmark\n\n`{summary}`\n")).map_err(|e| e.to_string())?;
    Ok(quick || (accuracy >= 0.90 && false_rate <= 0.02))
}

fn parse(input: &str) -> Result<Vec<Case>, String> {
    input.lines().skip(1).filter(|line| !line.trim().is_empty()).map(|line| {
        let c: Vec<_> = line.split('\t').collect();
        if c.len() != 10 { return Err(format!("invalid TSV row: {line}")); }
        Ok(Case { id: c[0].into(), transcript: c[1].into(), wake: c[2] == "1", active: c[3] == "1", interrupted: c[4] == "1", route: c[5].into(), action: c[6].into(), closed: c[7].into(), agent: c[8].into(), risk_min: c[9].parse().map_err(|_| format!("invalid risk: {}", c[9]))? })
    }).collect()
}

fn matches_case(case: &Case, decision: &Decision) -> bool {
    if case.risk_min >= 1.5 && !matches!(decision, Decision::NeedConfirm { .. }) { return false; }
    match (case.route.as_str(), decision) {
        ("not_addressed", Decision::Ignore { .. }) | ("clarify", Decision::Incomplete | Decision::Clarify { .. }) => true,
        ("closed_command", Decision::Closed { intent }) => case.closed == intent.as_str() && case.risk_min < 1.5,
        ("closed_command", Decision::NeedConfirm { pending: PendingAction::Closed { intent }, .. }) => case.closed == intent.as_str(),
        ("coding_task", Decision::Coding { agent, .. }) => case.agent == "unspecified" || case.agent == agent.as_str(),
        ("coding_task", Decision::NeedConfirm { pending: PendingAction::Coding { agent, .. }, .. }) => case.agent == "unspecified" || case.agent == agent.as_str(),
        ("session_control", Decision::Session(action)) => case.action == action_name(action),
        ("computer_use", Decision::ComputerUse) | ("conversation", Decision::Chat) => true,
        _ => false,
    }
}

fn unsafe_execution(case: &Case, decision: &Decision) -> bool {
    let expected_safe = matches!(case.route.as_str(), "unclear" | "not_addressed" | "clarify") || case.risk_min >= 1.5;
    expected_safe && matches!(decision, Decision::Closed { .. } | Decision::Coding { .. } | Decision::Session(SessionAction::Stop | SessionAction::Correct { .. } | SessionAction::Append { .. }))
}

fn action_name(action: &SessionAction) -> &'static str {
    match action { SessionAction::Stop => "stop", SessionAction::Pause => "pause", SessionAction::Continue => "continue", SessionAction::Correct { .. } => "correct", SessionAction::Append { .. } => "append", SessionAction::Status => "status", SessionAction::Confirm => "confirm", SessionAction::Cancel => "cancel" }
}

fn percentile(values: &[u64], fraction: f64) -> u64 {
    if values.is_empty() { return 0; }
    values[((values.len() - 1) as f64 * fraction).round() as usize]
}

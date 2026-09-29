"""Accounting and unknown-data regressions; no provider/model simulation."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from context_budget import calculate_budget, capacity
from context_health import analyze_context


def test_window_and_cumulative_task_are_separate():
    result = calculate_budget(1000, 1000, 2000, 6000, window=20000,
        output_reserve=2000, checkpoint_reserve=1000, next_step=8000,
        task_limit=100000, task_spent=50000, agent_budgets={"scan": 10000},
        verification_reserve=5000)
    assert result["context"]["remaining"] == 10000
    assert result["context"]["next_step_fits"] is False
    assert result["context"]["checkpoint_recommended"] is True
    assert result["task"]["available_unallocated"] == 35000
    assert result["warning_threshold"] == 14000
    assert result["critical_threshold"] == 17000


def test_unknown_limits_do_not_invent_thresholds():
    result = calculate_budget(2000, 1500, 3000, 5000)
    assert result["total_budget"] == 13225
    assert result["warning_threshold"] is None
    assert result["context"]["utilization"] is None
    assert result["task"]["overcommitted"] is None


def test_overcommitted_not_clamped_to_zero():
    result = calculate_budget(0, 0, 0, 0, task_limit=50, task_spent=60)
    assert result["task"]["available_unallocated"] == -10
    assert result["task"]["overcommitted"] is True


@pytest.mark.parametrize("extra", [{"window": 0}, {"window": -1}, {"task_spent": -1},
    {"next_step": -1}, {"output_reserve": -1}, {"checkpoint_reserve": -1},
    {"buffer_pct": float("nan")}, {"buffer_pct": 2}, {"task_limit": float("inf")},
    {"agent_budgets": {"worker": -2}}, {"verification_reserve": True}])
def test_invalid_accounting_rejected(extra):
    with pytest.raises(ValueError):
        calculate_budget(0, 0, 0, 0, **extra)


@pytest.mark.parametrize("used,band", [(499, "green"), (500, "yellow"),
    (700, "orange"), (850, "red"), (1200, "red")])
def test_capacity_bands(used, band):
    assert capacity(used, 1000)["band"] == band


def test_fixed_errors_are_not_poisoning_measurements():
    result = analyze_context([{"content": "error failed exception invalid undefined null: all fixed"}])
    assert result["poisoning_risk"] is None
    assert result["health_score"] is None
    assert result["capacity"]["band"] == "unknown"
    assert len(result["lexical_signals"]) == 1


def test_runtime_usage_overrides_partial_message_estimate():
    result = analyze_context([{"content": "短い tiếng Việt"}], 1000, used_tokens=720)
    assert result["utilization"] == .72
    assert result["total_tokens"] == 720
    assert result["measurement"] == "runtime-reported-by-caller"
    assert result["capacity"]["band"] == "orange"


def test_cli_duplicate_allocations_fail():
    result = subprocess.run([sys.executable, str(SCRIPTS / "context_analyzer.py"),
        "budget", "--agent-budget", "scan=10", "--agent-budget", "scan=20"],
        capture_output=True, text=True)
    assert result.returncode == 1
    assert "distinct" in result.stderr


def test_cli_unknown_quality_and_invalid_window(tmp_path):
    source = tmp_path / "context.json"
    source.write_text(json.dumps([{"content": "complete"}]))
    command = [sys.executable, str(SCRIPTS / "context_analyzer.py"), "analyze", str(source)]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0
    assert json.loads(result.stdout)["health_score"] is None
    result = subprocess.run(command + ["--limit", "0"], capture_output=True, text=True)
    assert result.returncode == 1
    assert "Traceback" not in result.stderr


def test_log_capture_preserves_failure_and_full_evidence(tmp_path):
    # This is the documented shell pattern, including a failure outside the tail.
    script = '''log="$1"
status=0
(sh -c 'echo early-error; seq 1 100; exit 7') >"$log" 2>&1 || status=$?
tail -n 40 "$log"
printf 'exit_code=%s\\n' "$status"
exit "$status"
'''
    log = tmp_path / "check.log"
    result = subprocess.run(["bash", "-c", script, "check", str(log)], capture_output=True, text=True)
    assert result.returncode == 7
    assert "early-error" in log.read_text()
    assert "early-error" not in result.stdout
    assert "exit_code=7" in result.stdout

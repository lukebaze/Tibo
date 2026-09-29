"""Synthetic reducer unit fixtures, never measurements of real models."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
from benchmark_metrics import reduce_benchmarks  # noqa: E402


def row(task="a", success=True, cost=2, duration=10, steps=3, attempt=1):
    return {"task_id": task, "trial_id": "1", "attempt": attempt,
            "success": success, "cost": cost, "duration_seconds": duration,
            "agent_steps": steps}


def run(name="fixture-a", rows=None):
    return {
        "config": {"id": name, "model": name, "effort": "fixed", "harness": "fixture-v1"},
        "metadata": {
            "benchmark": "synthetic-unit-fixture", "benchmark_version": "1",
            "source": "unit-test", "date": "2026-09-08", "cohort": "fixture-cohort",
            "success_definition": "explicit fixture boolean",
            "duration_definition": "wall seconds including tools",
            "step_definition": "one agent turn", "limits": "10 steps; 60 seconds",
            "cost_basis": {"currency": "USD", "pricing": "supplied fixture amounts",
                           "cache": "included", "tools": "included"},
        },
        "rows": rows if rows is not None else [row()],
    }


def document(*runs, floor=.5):
    return {"schema_version": 1, "runs": list(runs) or [run()],
            "comparison": {"success_floor": floor}}


def summary(data):
    return reduce_benchmarks(data)["runs"][0]["summary"]


def test_failed_first_cost_included_and_retry_cost_separate():
    data = document(run(rows=[row("a", False, 2, 10, 2), row("b", True, 4, 30, 6),
                              row("a", True, 100, 80, 9, attempt=2)]))
    result = summary(data)
    assert result["sample_size"] == 2
    assert result["average_cost_per_task"]["value"] == 3
    assert result["average_duration_seconds"]["value"] == 20
    assert result["estimated_cost_per_first_success"]["value"] == 6
    assert result["average_agent_steps"]["value"] == 4
    assert result["first_attempt_success_rate"]["value"] == .5
    assert result["duration_p50_seconds"]["value"] == 20
    assert result["duration_p95_seconds"]["value"] == pytest.approx(29)
    assert result["total_retry_spend"]["value"] == 100
    assert result["first_attempt_success_rate"]["wilson_95"] == pytest.approx([.0945312, .9054688])


@pytest.mark.parametrize("field,metric", [
    ("cost", "average_cost_per_task"), ("duration_seconds", "average_duration_seconds"),
    ("agent_steps", "average_agent_steps"), ("success", "first_attempt_success_rate"),
])
@pytest.mark.parametrize("omit", [False, True])
def test_unknown_is_null_with_coverage(field, metric, omit):
    rows = [row("a"), row("b")]
    rows[1][field] = None
    if omit:
        del rows[1][field]
    result = summary(document(run(rows=rows)))
    assert result[metric]["value"] is None
    assert result[metric]["coverage"] == .5
    assert result[metric]["observed"] == 1
    if field in ("cost", "success"):
        assert result["estimated_cost_per_first_success"]["value"] is None


def test_zero_success_has_null_ratio_and_zero_is_a_valid_cost():
    result = summary(document(run(rows=[row(success=False, cost=0)])))
    assert result["average_cost_per_task"]["value"] == 0
    assert result["estimated_cost_per_first_success"]["value"] is None
    assert result["estimated_cost_per_first_success"]["reason"] == "no_first_attempt_successes"
    assert result["total_retry_spend"]["value"] == 0


def test_missing_retry_spend_does_not_change_first_attempt_metrics():
    result = summary(document(run(rows=[row(success=False), row(cost=None, attempt=2)])))
    assert result["average_cost_per_task"]["value"] == 2
    assert result["total_retry_spend"]["value"] is None


def test_matched_cohort_recomputed_and_exclusions_listed():
    a = run(rows=[row("a", cost=1), row("unmatched", cost=1000)])
    b = run("fixture-b", rows=[row("a", cost=2)])
    result = reduce_benchmarks(document(a, b))["comparison"]
    assert result["matched_summaries"]["fixture-a"]["average_cost_per_task"]["value"] == 1
    assert result["excluded_first_attempts"] == {"fixture-a": 1, "fixture-b": 0}
    assert result["excluded_task_trials"]["fixture-a"] == [{"task_id": "unmatched", "trial_id": "1"}]
    assert result["pareto_config_ids"] == ["fixture-a"]


@pytest.mark.parametrize("field", ["source", "date", "cohort", "success_definition", "limits", "cost_basis"])
def test_metadata_mismatch_prevents_comparison(field):
    a, b = run(), run("fixture-b")
    b["metadata"][field] = ({**a["metadata"][field], "tools": "excluded"} if field == "cost_basis"
                            else "2026-09-09" if field == "date" else "different")
    result = reduce_benchmarks(document(a, b))["comparison"]
    assert not result["eligible"]
    assert result["reason"] == "metadata_mismatch"
    assert result["mismatched_fields"] == [field]


def test_success_floor_required_and_quality_gate_before_pareto():
    a = run(rows=[row("a", success=False, cost=.01), row("b", cost=.01)])
    b = run("fixture-b", rows=[row("a", cost=3), row("b", cost=3)])
    data = document(a, b, floor=.75)
    result = reduce_benchmarks(data)["comparison"]
    assert result["shortlist_config_ids"] == ["fixture-b"]
    assert result["matched_summaries"]["fixture-a"]["shortlist_exclusion"] == "below_success_floor"
    assert result["matched_summaries"]["fixture-b"]["success_floor_uncertainty_advisory"]
    del data["comparison"]["success_floor"]
    assert reduce_benchmarks(data)["comparison"]["reason"] == "success_floor_required"


def test_pareto_preserves_tradeoffs_and_steps_only_order_exact_ties():
    data = document(run("cheap", [row(cost=1, duration=10, steps=99)]),
                    run("fast", [row(cost=2, duration=5, steps=99)]),
                    run("dominated", [row(cost=3, duration=10, steps=1)]),
                    run("tie", [row(cost=1, duration=10, steps=2)]))
    result = reduce_benchmarks(data)["comparison"]
    assert result["pareto_config_ids"] == ["tie", "cheap", "fast"]


def test_empty_intersection_and_incomplete_observations_never_rank():
    a, b = run(), run("fixture-b", [row("b")])
    assert reduce_benchmarks(document(a, b))["comparison"]["reason"] == "no_matched_task_trials"
    b["rows"] = [row(cost=None)]
    result = reduce_benchmarks(document(a, b))["comparison"]
    assert result["shortlist_config_ids"] == ["fixture-a"]
    assert result["matched_summaries"]["fixture-b"]["shortlist_exclusion"] == "incomplete_first_attempt_observations"


@pytest.mark.parametrize("field,value", [
    ("success", 1), ("success", "true"), ("attempt", True), ("attempt", 0),
    ("attempt", 1.5), ("cost", True), ("cost", -1), ("cost", float("nan")),
    ("duration_seconds", float("inf")), ("agent_steps", 1.5), ("agent_steps", False),
])
def test_invalid_observations_rejected(field, value):
    data = document()
    data["runs"][0]["rows"][0][field] = value
    with pytest.raises(ValueError):
        reduce_benchmarks(data)


@pytest.mark.parametrize("rows", [[row(attempt=2)], [row(), row()],
                                  [row(success=False), row(attempt=3)],
                                  [row(), row(attempt=2)]])
def test_duplicate_discontinuous_and_post_success_attempts_rejected(rows):
    with pytest.raises(ValueError):
        reduce_benchmarks(document(run(rows=rows)))


def test_trial_ids_match_and_out_of_order_contiguous_attempts_are_valid():
    a = run(rows=[row(attempt=2), row(success=False)])
    assert summary(document(a))["retry_attempts"] == 1
    b = run("fixture-b")
    b["rows"][0]["trial_id"] = "2"
    assert reduce_benchmarks(document(a, b))["comparison"]["reason"] == "no_matched_task_trials"


def test_cli_json_stdin_and_validation_errors():
    command = [sys.executable, str(SCRIPTS / "benchmark_metrics.py"), "-"]
    completed = subprocess.run(command, input=json.dumps(document()), text=True, capture_output=True)
    assert completed.returncode == 0
    assert json.loads(completed.stdout)["schema_version"] == 1
    for raw in ('{"schema_version":1,"schema_version":1}', '{"runs":NaN}', '[]', '{'):
        completed = subprocess.run(command, input=raw, text=True, capture_output=True)
        assert completed.returncode == 1
        assert not completed.stdout
        assert "Error:" in completed.stderr

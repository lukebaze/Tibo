"""Malformed-input and boundary coverage for offline reducer contracts."""

import json
import subprocess
import sys

import pytest

from test_benchmark_metrics import SCRIPTS, document, reduce_benchmarks, row, run, summary


@pytest.mark.parametrize("version", [True, 1.0, "1", 0, 2, None])
def test_version_is_exact_integer(version):
    data = document()
    data["schema_version"] = version
    with pytest.raises(ValueError, match="schema_version"):
        reduce_benchmarks(data)


@pytest.mark.parametrize("runs", [None, {}, [], "runs"])
def test_runs_are_nonempty_array(runs):
    data = document()
    data["runs"] = runs
    with pytest.raises(ValueError, match="runs"):
        reduce_benchmarks(data)


@pytest.mark.parametrize("key", ["benchmark", "benchmark_version", "cohort", "source",
                                "success_definition", "duration_definition", "step_definition", "limits"])
def test_comparison_metadata_is_required(key):
    data = document()
    del data["runs"][0]["metadata"][key]
    with pytest.raises(ValueError, match=key):
        reduce_benchmarks(data)


@pytest.mark.parametrize("date", ["20260908", "2026-02-30", "2026-09-08T10:00:00Z", "yesterday"])
def test_date_format_is_unambiguous(date):
    data = document()
    data["runs"][0]["metadata"]["date"] = date
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        reduce_benchmarks(data)


@pytest.mark.parametrize("floor", [-.1, 1.1, True, "0.5", float("nan"), None])
def test_success_floor_is_probability_threshold(floor):
    with pytest.raises(ValueError, match="success_floor"):
        reduce_benchmarks(document(floor=floor))


@pytest.mark.parametrize("ids", [[], "fixture-a", [1], ["unknown"], ["fixture-a", "fixture-a"]])
def test_selected_configuration_ids_are_unique_and_known(ids):
    data = document()
    data["comparison"]["config_ids"] = ids
    with pytest.raises(ValueError, match="config_ids"):
        reduce_benchmarks(data)


def test_duplicate_configuration_and_unknown_measurement_rejected():
    with pytest.raises(ValueError, match="unique"):
        reduce_benchmarks(document(run(), run()))
    data = document()
    data["runs"][0]["rows"][0]["intelligence_score"] = .95
    with pytest.raises(ValueError, match="unknown fields"):
        reduce_benchmarks(data)


def test_large_finite_mean_does_not_overflow_and_zero_cost_success_is_valid():
    result = summary(document(run(rows=[row("a", cost=1e308), row("b", cost=1e308)])))
    assert result["average_cost_per_task"]["value"] == 1e308
    assert result["estimated_cost_per_first_success"]["value"] == 1e308
    assert summary(document(run(rows=[row(cost=0)])))["estimated_cost_per_first_success"]["value"] == 0


def test_cli_file_and_aggregate_overflow_errors(tmp_path):
    path = tmp_path / "observations.json"
    command = [sys.executable, str(SCRIPTS / "benchmark_metrics.py"), str(path)]
    missing = subprocess.run(command, capture_output=True, text=True)
    assert missing.returncode == 1
    assert not missing.stdout
    path.write_text(json.dumps(document()), encoding="utf-8")
    assert subprocess.run(command, capture_output=True, text=True).returncode == 0
    rows = [row("a", success=False, cost=1e308), row("b", cost=1e308)]
    path.write_text(json.dumps(document(run(rows=rows))), encoding="utf-8")
    overflow = subprocess.run(command, capture_output=True, text=True)
    assert overflow.returncode == 1
    assert not overflow.stdout
    assert "Error:" in overflow.stderr


WINNER = {"picked": 3, "of": 5, "margin": "high", "unanimous": False}
UNION = {"union_kept": 7, "union_proposed": 9, "single_candidate_only": 2}


def test_ultra_receipt_is_optional():
    assert reduce_benchmarks(document())["runs"][0]["ultra"] is None


def test_ultra_winner_receipt_rolls_up():
    data = document(run(rows=[row("a") | {"ultra": WINNER},
                              row("b") | {"ultra": dict(WINNER, picked=1, margin="low",
                                                        unanimous=True)}]))
    rollup = reduce_benchmarks(data)["runs"][0]["ultra"]
    assert rollup["receipts"] == 2
    assert rollup["winner"] == {"count": 2, "high_margin": 1, "low_margin": 1,
                                "unanimous": 1, "picked_first": 1}
    assert "union" not in rollup


def test_ultra_union_receipt_rolls_up():
    data = document(run(rows=[row("a") | {"ultra": UNION}]))
    rollup = reduce_benchmarks(data)["runs"][0]["ultra"]
    assert rollup["union"] == {"count": 1, "kept": 7, "proposed": 9,
                               "single_candidate_only": 2}


def test_ultra_rollup_ignores_retry_attempts():
    data = document(run(rows=[row("a", success=False) | {"ultra": WINNER},
                              row("a", attempt=2) | {"ultra": WINNER}]))
    assert reduce_benchmarks(data)["runs"][0]["ultra"]["receipts"] == 1


@pytest.mark.parametrize("ultra", [
    {}, {"picked": 3}, dict(WINNER, picked=6), dict(WINNER, picked=0),
    dict(WINNER, margin="medium"), dict(WINNER, unanimous="yes"),
    dict(UNION, union_kept=10), dict(UNION, single_candidate_only=8),
    dict(UNION, single_candidate_only=-1), WINNER | UNION, "high",
])
def test_ultra_receipt_shape_is_enforced(ultra):
    data = document(run(rows=[row("a") | {"ultra": ultra}]))
    with pytest.raises(ValueError, match="ultra"):
        reduce_benchmarks(data)

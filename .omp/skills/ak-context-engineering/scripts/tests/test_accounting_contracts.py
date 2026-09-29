"""Independent budget and skill-only comparison regressions; synthetic input only."""

import subprocess
import sys

import pytest

from test_benchmark_metrics import SCRIPTS, document, reduce_benchmarks, row, run
from context_budget import calculate_budget, capacity


@pytest.mark.parametrize("option", ["--system", "--window", "--task-limit"])
def test_oversized_budget_integer_is_clean_validation_error(option):
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "context_analyzer.py"), "budget",
         option, str(10 ** 400)], capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert not result.stdout
    assert "Error:" in result.stderr
    assert "Traceback" not in result.stderr


def test_oversized_direct_budget_integer_is_validation_error():
    with pytest.raises(ValueError):
        calculate_budget(10 ** 400, 0, 0, 0)


def test_overflowing_headroom_reserves_are_rejected():
    with pytest.raises(ValueError):
        capacity(0, 1e308, next_step=1e308, output_reserve=1e308)


@pytest.mark.parametrize("components,options", [
    ((1e308, 1e308, 0, 0), {}),
    ((0, 0, 0, 0), {"task_limit": 1e308,
                    "agent_budgets": {"a": 1e308, "b": 1e308}}),
])
def test_overflowing_category_or_allocation_sums_are_rejected(components, options):
    with pytest.raises(ValueError):
        calculate_budget(*components, **options)


def test_same_model_skill_variants_can_be_compared():
    baseline = run("baseline", [row(cost=2)])
    candidate = run("updated-skill", [row(cost=1)])
    candidate["config"].update({key: baseline["config"][key]
                               for key in ("model", "effort", "harness")})
    result = reduce_benchmarks(document(baseline, candidate))["comparison"]
    assert result["eligible"] is True
    assert result["pareto_config_ids"] == ["updated-skill"]


def test_worker_spend_transfer_does_not_double_count_commitments():
    before = calculate_budget(10, 20, 30, 40, task_limit=1000, task_spent=100,
                              agent_budgets={"worker": 200}, verification_reserve=50)
    after = calculate_budget(10, 20, 30, 40, task_limit=1000, task_spent=180,
                             agent_budgets={"worker": 120}, verification_reserve=50)
    assert before["task"]["available_unallocated"] == 650
    assert after["task"]["available_unallocated"] == 650
    assert before["context"] == after["context"]

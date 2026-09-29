#!/usr/bin/env python3
"""Reduce offline benchmark JSON to comparable first-attempt efficiency metrics.

Usage: python benchmark_metrics.py observations.json (or - for stdin).
No provider access, model price table, quality-score conversion, or weighted score.
"""

import argparse
import json
import sys
from pathlib import Path

from benchmark_statistics import summarize
from benchmark_validation import validate_document


def compare(runs, policy):
    result = {"eligible": False, "reason": None, "success_floor": None,
              "floor_basis": "observed_first_attempt_success_rate",
              "pareto_config_ids": [], "shortlist_config_ids": []}
    if policy is None or "success_floor" not in policy:
        result["reason"] = "success_floor_required"
        return result
    result["success_floor"] = policy["success_floor"]
    selected = policy.get("config_ids", [run["config"]["id"] for run in runs])
    by_id = {run["config"]["id"]: run for run in runs}
    runs = [by_id[config_id] for config_id in selected]
    result["config_ids"] = selected
    if len(runs) < 2:
        result["reason"] = "at_least_two_configs_required"
        return result
    mismatches = sorted({key for run in runs[1:] for key in runs[0]["metadata"]
                         if run["metadata"][key] != runs[0]["metadata"][key]})
    if mismatches:
        result.update(reason="metadata_mismatch", mismatched_fields=mismatches)
        return result
    first_keys = [{(row["task_id"], row["trial_id"]) for row in run["rows"]
                   if row["attempt"] == 1} for run in runs]
    matched = set.intersection(*first_keys)
    result["matched_cohort"] = [{"task_id": task, "trial_id": trial}
                                for task, trial in sorted(matched)]
    result["excluded_first_attempts"] = {
        run["config"]["id"]: len(keys - matched) for run, keys in zip(runs, first_keys)}
    result["excluded_task_trials"] = {
        run["config"]["id"]: [{"task_id": task, "trial_id": trial}
                               for task, trial in sorted(keys - matched)]
        for run, keys in zip(runs, first_keys)}
    if not matched:
        result["reason"] = "no_matched_task_trials"
        return result
    summaries = {}
    candidates = []
    for run in runs:
        config_id = run["config"]["id"]
        rows = [row for row in run["rows"]
                if (row["task_id"], row["trial_id"]) in matched]
        summary = summarize(rows)
        interval = summary["first_attempt_success_rate"]["wilson_95"]
        summary["success_floor_uncertainty_advisory"] = (
            "wilson_lower_bound_below_floor" if interval and interval[0] < policy["success_floor"]
            else None)
        summaries[config_id] = summary
        required = ("average_cost_per_task", "average_duration_seconds",
                    "average_agent_steps", "first_attempt_success_rate")
        if any(summary[key]["value"] is None for key in required):
            summary["shortlist_exclusion"] = "incomplete_first_attempt_observations"
        elif summary["first_attempt_success_rate"]["value"] < policy["success_floor"]:
            summary["shortlist_exclusion"] = "below_success_floor"
        elif summary["estimated_cost_per_first_success"]["value"] is None:
            summary["shortlist_exclusion"] = "no_first_attempt_successes"
        else:
            summary["shortlist_exclusion"] = None
            candidates.append(config_id)
    result["matched_summaries"] = summaries
    result["shortlist_config_ids"] = candidates
    axes = ("estimated_cost_per_first_success", "average_duration_seconds")

    def dominates(left, right):
        a = [summaries[left][axis]["value"] for axis in axes]
        b = [summaries[right][axis]["value"] for axis in axes]
        return all(x <= y for x, y in zip(a, b)) and any(x < y for x, y in zip(a, b))

    frontier = [item for item in candidates
                if not any(dominates(other, item) for other in candidates if other != item)]
    # Steps only order exact cost/time ties; they never change Pareto membership.
    result["pareto_config_ids"] = sorted(frontier, key=lambda item: (
        *(summaries[item][axis]["value"] for axis in axes),
        summaries[item]["average_agent_steps"]["value"], item))
    result.update(eligible=bool(candidates), reason=None if candidates else "no_eligible_configs")
    return result


def ultra_rollup(rows):
    """Summarize the ultra verifier receipts on a run's first attempts.

    Returns None when the run carries no receipts, so a non-ultra config stays
    directly comparable with an ultra one on the same cohort.
    """
    receipts = [row["ultra"] for row in rows
                if row["attempt"] == 1 and row.get("ultra") is not None]
    if not receipts:
        return None
    winners = [item for item in receipts if "margin" in item]
    unions = [item for item in receipts if "union_kept" in item]
    rollup = {"receipts": len(receipts)}
    if winners:
        rollup["winner"] = {
            "count": len(winners),
            "high_margin": sum(1 for item in winners if item["margin"] == "high"),
            "low_margin": sum(1 for item in winners if item["margin"] == "low"),
            "unanimous": sum(1 for item in winners if item["unanimous"]),
            # A first-slot win is what the default single-pass path would also
            # have produced, so it is the clearest no-gain signal.
            "picked_first": sum(1 for item in winners if item["picked"] == 1),
        }
    if unions:
        rollup["union"] = {
            "count": len(unions),
            "kept": sum(item["union_kept"] for item in unions),
            "proposed": sum(item["union_proposed"] for item in unions),
            # Findings a single candidate raised alone are the coverage the
            # fan-out bought; zero means a single pass would have found the same.
            "single_candidate_only": sum(item["single_candidate_only"] for item in unions),
        }
    return rollup


def reduce_benchmarks(document):
    validate_document(document)
    result = {
        "schema_version": 1,
        "metric_scope": "first_attempt_per_task_trial; retries reported separately",
        "uncertainty_note": "Wilson 95% assumes independent Bernoulli trials; repeated tasks may be correlated.",
        "percentile_method": "linear interpolation at (n-1)*p",
        "runs": [{"config": run["config"], "metadata": run["metadata"],
                  "summary": summarize(run["rows"]),
                  "ultra": ultra_rollup(run["rows"])} for run in document["runs"]],
        "comparison": compare(document["runs"], document.get("comparison")),
    }
    # Fail explicitly if aggregate arithmetic exceeds representable JSON numbers.
    json.dumps(result, allow_nan=False)
    return result


def reject_constant(value):
    raise ValueError(f"nonfinite JSON constant is invalid: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="JSON observations file; - reads stdin")
    args = parser.parse_args(argv)
    try:
        raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8")
        document = json.loads(raw, parse_constant=reject_constant, object_pairs_hook=unique_object)
        result = reduce_benchmarks(document)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, OverflowError, UnicodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

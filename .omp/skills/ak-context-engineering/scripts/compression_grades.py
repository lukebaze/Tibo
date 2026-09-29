"""Validate complete externally supplied judgments against an explicit probe rubric."""

import math

from compression_probes import canonical_json

DIMENSIONS = {
    "accuracy": "Technical correctness",
    "context_awareness": "Conversation state",
    "artifact_trail": "Artifact identity and state",
    "completeness": "Coverage and depth",
    "continuity": "Work continuation",
    "instruction_following": "Constraint adherence",
}
PROBE_DIMENSIONS = {
    "recall": ("accuracy", "completeness"),
    "artifact": ("accuracy", "artifact_trail"),
    "continuation": ("continuity", "context_awareness"),
    "decision": ("accuracy", "context_awareness"),
    "constraint": ("accuracy", "instruction_following"),
}


def nonempty_text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be nonempty text")


def validate_grades(data, hashes, probes):
    """Hash binding is attribution, not independent proof that a judge is correct."""
    canonical_json(data)
    if not probes or not all(p.reviewed for p in probes):
        raise ValueError("Grades require a nonempty, fully reviewed probe set")
    if not isinstance(data, dict) or type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        raise ValueError("Grades require schema_version 1")
    for name, expected in hashes.items():
        if data.get(name) != expected:
            raise ValueError(f"Grades {name} does not match evaluated inputs")
    judge = data.get("judge")
    if not isinstance(judge, dict):
        raise ValueError("Grades require judge attribution")
    for name in ("id", "method"):
        nonempty_text(judge.get(name), f"judge.{name}")
    records = data.get("results")
    if not isinstance(records, list):
        raise ValueError("Grades results must be a list")
    expected_ids = {p.id for p in probes}
    by_id = {}
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Each grade must be an object")
        probe_id = record.get("probe_id")
        nonempty_text(probe_id, "probe_id")
        if probe_id not in expected_ids or probe_id in by_id:
            raise ValueError("Grade probe IDs must match the rubric exactly once")
        for name in ("response", "evidence"):
            nonempty_text(record.get(name), f"grade.{name}")
        by_id[probe_id] = record
    if set(by_id) != expected_ids:
        raise ValueError("Grades must cover every probe, including critical constraints")
    dimensions = {name: [] for name in DIMENSIONS}
    results, failures, means = [], [], []
    for probe in probes:
        record = by_id[probe.id]
        scores = record.get("scores")
        required = PROBE_DIMENSIONS[probe.type.value]
        if not isinstance(scores, dict) or set(scores) != set(required):
            raise ValueError(f"Probe {probe.id} scores must cover exactly {', '.join(required)}")
        for name, score in scores.items():
            if type(score) not in (int, float) or not 0 <= score <= 1 or not math.isfinite(score):
                raise ValueError("Scores must be finite numbers between 0 and 1")
            dimensions[name].append(score)
        mean = sum(scores.values()) / len(scores)
        means.append(mean)
        if probe.critical and any(score < 1 for score in scores.values()):
            failures.append(probe.id)
        results.append({**record, "overall_score": mean, "critical": probe.critical})
    return {
        "quality_status": "failed_critical_constraint" if failures else "externally_graded",
        "quality_score": 0.0 if failures else sum(means) / len(means),
        "graded_mean_score": sum(means) / len(means),
        "dimension_scores": {k: sum(v) / len(v) if v else None for k, v in dimensions.items()},
        "critical_constraint_failures": failures,
        "judge": judge, "probe_results": results,
        "coverage": {"total_probes": len(probes), "graded_probes": len(results),
                     "fraction": 1.0, "critical_probes": sum(p.critical for p in probes),
                     "scope": "supplied reviewed rubric; source completeness is not automatically verified"},
    }

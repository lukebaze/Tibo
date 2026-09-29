"""Validate the versioned, offline benchmark observation contract."""

import math
from datetime import date


METADATA_TEXT = (
    "benchmark", "benchmark_version", "source", "date", "cohort",
    "success_definition", "duration_definition", "step_definition", "limits",
)
CONFIG_TEXT = ("id", "model", "effort", "harness")
ROW_FIELDS = {"task_id", "trial_id", "attempt", "success", "cost",
              "duration_seconds", "agent_steps", "ultra"}
# Optional per-attempt receipt written by the ultra verifier, in one of two
# shapes: winner-selection skills report which candidate won and by how much;
# union skills report coverage, where findings only one candidate raised are
# the part a single pass would have missed. Both let a cohort ask whether the
# five-way fan-out changed the outcome it was paid for.
ULTRA_WINNER_FIELDS = ("picked", "of", "margin", "unanimous")
ULTRA_UNION_FIELDS = ("union_kept", "union_proposed", "single_candidate_only")
ULTRA_MARGINS = ("high", "low")


def object_fields(value, allowed, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    unknown = value.keys() - set(allowed)
    if unknown:
        raise ValueError(f"{label}: unknown fields {sorted(unknown)}")


def text_fields(value, fields, label):
    for field in fields:
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError(f"{label}.{field} must be nonempty text")


def number(value, label, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite nonnegative number")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite or value < 0 or (integer and not isinstance(value, int)):
        raise ValueError(f"{label} must be a finite nonnegative {'integer' if integer else 'number'}")


def validate_ultra(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    if value.keys() == set(ULTRA_WINNER_FIELDS):
        for field in ("picked", "of"):
            number(value[field], f"{label}.{field}", integer=True)
            if value[field] < 1:
                raise ValueError(f"{label}.{field} must be at least 1")
        if value["picked"] > value["of"]:
            raise ValueError(f"{label}.picked cannot exceed {label}.of")
        if value["margin"] not in ULTRA_MARGINS:
            raise ValueError(f"{label}.margin must be one of {ULTRA_MARGINS}")
        if not isinstance(value["unanimous"], bool):
            raise ValueError(f"{label}.unanimous must be boolean")
        return
    if value.keys() == set(ULTRA_UNION_FIELDS):
        for field in ULTRA_UNION_FIELDS:
            number(value[field], f"{label}.{field}", integer=True)
            if value[field] < 0:
                raise ValueError(f"{label}.{field} cannot be negative")
        if value["union_kept"] > value["union_proposed"]:
            raise ValueError(f"{label}.union_kept cannot exceed {label}.union_proposed")
        if value["single_candidate_only"] > value["union_kept"]:
            raise ValueError(f"{label}.single_candidate_only cannot exceed {label}.union_kept")
        return
    raise ValueError(
        f"{label} must carry exactly {ULTRA_WINNER_FIELDS} or {ULTRA_UNION_FIELDS}")


def validate_rows(rows, label):
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{label}.rows must be a nonempty array")
    trials = {}
    for index, row in enumerate(rows):
        row_label = f"{label}.rows[{index}]"
        object_fields(row, ROW_FIELDS, row_label)
        text_fields(row, ("task_id", "trial_id"), row_label)
        number(row.get("attempt"), f"{row_label}.attempt", integer=True)
        if row["attempt"] < 1:
            raise ValueError(f"{row_label}.attempt must start at 1")
        if row.get("success") is not None and not isinstance(row["success"], bool):
            raise ValueError(f"{row_label}.success must be boolean or null")
        for field in ("cost", "duration_seconds", "agent_steps"):
            if row.get(field) is not None:
                number(row[field], f"{row_label}.{field}", integer=field == "agent_steps")
        if row.get("ultra") is not None:
            validate_ultra(row["ultra"], f"{row_label}.ultra")
        attempts = trials.setdefault((row["task_id"], row["trial_id"]), {})
        if row["attempt"] in attempts:
            raise ValueError(f"{row_label}: duplicate task/trial/attempt")
        attempts[row["attempt"]] = row
    for key, attempts in trials.items():
        if sorted(attempts) != list(range(1, len(attempts) + 1)):
            raise ValueError(f"{label} {key}: attempts must be contiguous starting at 1")
        if any(row.get("success") is True and attempt < len(attempts)
               for attempt, row in attempts.items()):
            raise ValueError(f"{label} {key}: retries after success are invalid; use a new trial_id")


def validate_document(document):
    object_fields(document, ("schema_version", "runs", "comparison"), "input")
    if type(document.get("schema_version")) is not int or document["schema_version"] != 1:
        raise ValueError("schema_version must be integer 1")
    runs = document.get("runs")
    if not isinstance(runs, list) or not runs:
        raise ValueError("runs must be a nonempty array")
    ids = set()
    for index, run in enumerate(runs):
        label = f"runs[{index}]"
        object_fields(run, ("config", "metadata", "rows"), label)
        config = run.get("config")
        object_fields(config, CONFIG_TEXT, f"{label}.config")
        text_fields(config, CONFIG_TEXT, f"{label}.config")
        if config["id"] in ids:
            raise ValueError("config id must be unique across runs")
        ids.add(config["id"])
        metadata = run.get("metadata")
        object_fields(metadata, (*METADATA_TEXT, "cost_basis"), f"{label}.metadata")
        text_fields(metadata, METADATA_TEXT, f"{label}.metadata")
        try:
            parsed = date.fromisoformat(metadata["date"])
            if parsed.isoformat() != metadata["date"]:
                raise ValueError()
        except ValueError:
            raise ValueError(f"{label}.metadata.date must be YYYY-MM-DD") from None
        basis = metadata.get("cost_basis")
        basis_fields = ("currency", "pricing", "cache", "tools")
        object_fields(basis, basis_fields, f"{label}.metadata.cost_basis")
        text_fields(basis, basis_fields, f"{label}.metadata.cost_basis")
        validate_rows(run.get("rows"), label)
    policy = document.get("comparison")
    if policy is not None:
        object_fields(policy, ("config_ids", "success_floor"), "comparison")
        if "success_floor" in policy:
            number(policy["success_floor"], "comparison.success_floor")
            if policy["success_floor"] > 1:
                raise ValueError("comparison.success_floor must be between 0 and 1")
        selected = policy.get("config_ids", [run["config"]["id"] for run in runs])
        if (not isinstance(selected, list) or not selected
                or any(not isinstance(item, str) for item in selected)):
            raise ValueError("comparison.config_ids must be a nonempty array of strings")
        if len(set(selected)) != len(selected) or not set(selected).issubset(ids):
            raise ValueError("comparison.config_ids must be unique known config ids")

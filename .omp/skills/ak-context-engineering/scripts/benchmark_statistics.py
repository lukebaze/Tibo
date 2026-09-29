"""First-attempt descriptive metrics; no retry-success forecasting."""

import math


def metric(value, observed, total, reason=None):
    return {"value": value, "observed": observed, "total": total,
            "coverage": observed / total if total else None, "reason": reason}


def aggregate(rows, field, operation):
    values = [row[field] for row in rows if row.get(field) is not None]
    if len(values) != len(rows):
        return metric(None, len(values), len(rows), "missing_observations")
    if not values:
        return metric(None, 0, 0, "no_observations")
    return metric(operation(values), len(values), len(rows))


def mean(values):
    # Divide first to avoid overflow for a representable mean of large values.
    return math.fsum(value / len(values) for value in values)


def percentile(values, fraction):
    """Linear interpolation at (n - 1) * fraction, including n=1."""
    values = sorted(values)
    position = (len(values) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    weight = position - lower
    return values[lower] * (1 - weight) + values[upper] * weight


def wilson(successes, count):
    if not count:
        return None
    z = 1.959963984540054
    proportion = successes / count
    denominator = 1 + z * z / count
    center = (proportion + z * z / (2 * count)) / denominator
    margin = z * math.sqrt(proportion * (1 - proportion) / count
                           + z * z / (4 * count * count)) / denominator
    return [max(0.0, center - margin), min(1.0, center + margin)]


def summarize(rows):
    first = [row for row in rows if row["attempt"] == 1]
    retries = [row for row in rows if row["attempt"] > 1]
    count = len(first)
    known = sum(row.get("success") is not None for row in first)
    successes = sum(row.get("success") is True for row in first)
    costs = aggregate(first, "cost", mean)
    duration = aggregate(first, "duration_seconds", mean)
    steps = aggregate(first, "agent_steps", mean)
    rate = metric(successes / count if count and known == count else None,
                  known, count, "missing_observations" if known != count else None)
    rate["successes"] = successes
    rate["wilson_95"] = wilson(successes, count) if known == count else None
    complete = sum(row.get("cost") is not None and row.get("success") is not None
                   for row in first)
    reason = None
    cost_per_success = None
    if complete != count:
        reason = "missing_observations"
    elif not successes:
        reason = "no_first_attempt_successes"
    else:
        cost_per_success = math.fsum(row["cost"] / successes for row in first)
    retry_cost = (aggregate(retries, "cost", math.fsum) if retries
                  else metric(0, 0, 0, "no_retries"))
    return {
        "sample_size": count,
        "unique_tasks": len({row["task_id"] for row in first}),
        "attempt_rows": len(rows),
        "average_cost_per_task": costs,
        "average_duration_seconds": duration,
        "estimated_cost_per_first_success": metric(cost_per_success, complete, count, reason),
        "average_agent_steps": steps,
        "first_attempt_success_rate": rate,
        "duration_p50_seconds": aggregate(first, "duration_seconds", lambda v: percentile(v, .5)),
        "duration_p95_seconds": aggregate(first, "duration_seconds", lambda v: percentile(v, .95)),
        "retry_attempts": len(retries),
        "total_retry_spend": retry_cost,
    }

"""Exact local diagnostics and matched metadata comparisons."""
import math
from collections import Counter
from semantic_routing_contract import unwrap


def classify_batch(envelope, batch, roster):
    result = unwrap(envelope)
    if result.get("status") != "completed":
        raise ValueError(result.get("fallback_reason", "provider_incomplete"))
    provenance = result.get("provenance", {})
    if not isinstance(provenance, dict):
        raise ValueError("invalid provenance")
    identity = {k: provenance.get(k) for k in ("provider", "resolved_model")}
    identity["profile_version"] = result.get("profile_version")
    if not all(isinstance(v, str) and v for v in identity.values()):
        raise ValueError("unresolved provider identity")
    answers = result.get("answers", {})
    if not isinstance(answers, dict) or set(answers) != {f"c{i:03}" for i in range(len(batch))}:
        raise ValueError("missing or unexpected answer IDs")
    options = {f"s{i:03}": skill for i, skill in enumerate(roster)} | {"none": "none"}
    rows = []
    for i, case in enumerate(batch):
        answer = answers[f"c{i:03}"]
        if not isinstance(answer, dict) or set(answer) - {"kind", "choice", "confidence", "probabilities"}:
            raise ValueError("invalid choice answer fields")
        probs = answer.get("probabilities", {})
        if answer.get("kind") != "choice" or not isinstance(probs, dict) or set(probs) != set(options):
            raise ValueError("incomplete probability map")
        if any(type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1 for p in probs.values()) or abs(sum(probs.values()) - 1) > .001:
            raise ValueError("invalid probability values")
        confidence = answer.get("confidence")
        if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ValueError("invalid confidence")
        winner = answer.get("choice")
        if winner not in options or probs[winner] < max(probs.values()):
            raise ValueError("invalid choice")
        probabilities = {options[k]: value for k, value in probs.items()}
        top = sorted(probabilities, key=lambda key: (-probabilities[key], key))
        rows.append({"case_id": case["id"], "expected": case["expected"], "predicted": options[winner], "probabilities": probabilities, "top_competitors": top})
    return rows, identity


class Metrics:
    def __init__(self, roster):
        self.counts = {skill: dict(TP=0, FP=0, FN=0, TN=0) for skill in roster + ["none"]}
        self.confusion = Counter()
        self.completed = 0
        self.probabilities = Counter()

    def add(self, row):
        self.completed += 1
        self.probabilities.update(row["probabilities"])
        self.confusion[(row["expected"], row["predicted"])]+=1
        for skill, counts in self.counts.items():
            actual, predicted = row["expected"] == skill, row["predicted"] == skill
            counts["TP" if actual and predicted else "FN" if actual else "FP" if predicted else "TN"] += 1

    def report(self):
        result = {}
        for skill, c in self.counts.items():
            result[skill] = c | {"precision": c["TP"] / (c["TP"] + c["FP"]) if c["TP"] + c["FP"] else None,
                                  "recall": c["TP"] / (c["TP"] + c["FN"]) if c["TP"] + c["FN"] else None}
        return {"mean_probabilities": {s: self.probabilities[s] / self.completed if self.completed else None for s in self.counts}, "per_skill": result, "confusion_pairs": [{"expected": e, "predicted": p, "count": n} for (e, p), n in sorted(self.confusion.items())]}


def compare(before, after):
    if not isinstance(before, dict) or not isinstance(after, dict):
        raise ValueError("invalid comparison report")
    keys = ("protocol", "cases_hash", "holdout_id", "split", "roster", "runtime", "scope", "batch_schedule", "provider")
    differences = [key for key in keys if key not in before or key not in after or before[key] is None or before[key] != after[key]]
    for report in (before, after):
        if not isinstance(report.get("provider"), dict) or not all(isinstance(report["provider"].get(k), str) and report["provider"][k] for k in ("provider", "resolved_model", "profile_version")):
            differences.append("missing_evaluator_identity")
    if before.get("status") != "completed" or after.get("status") != "completed":
        differences.append("incomplete_coverage")
    result = {"evidence_kind": "diagnostic_model_choice", "status": "confounded" if differences else "matched", "confounds": differences,
              "catalog_hash_before": before.get("catalog_hash"), "catalog_hash_after": after.get("catalog_hash"), "improvement": None}
    if differences:
        return result
    result["metadata_delta"] = {skill: {"before": before["catalog_metadata"][skill], "after": after["catalog_metadata"][skill]} for skill in before["roster"] if before["catalog_metadata"][skill] != after["catalog_metadata"][skill]}
    result["count_deltas"] = {skill: {key: after["metrics"]["per_skill"][skill][key] - before["metrics"]["per_skill"][skill][key] for key in ("TP", "FP", "FN", "TN")} for skill in before["metrics"]["per_skill"]}
    result["probability_deltas"] = {s: after["metrics"]["mean_probabilities"][s] - before["metrics"]["mean_probabilities"][s] for s in before["metrics"]["per_skill"]}
    result["confusion_before"] = before["metrics"]["confusion_pairs"]
    result["confusion_after"] = after["metrics"]["confusion_pairs"]
    result["interpretation"] = "Diagnostic deltas only; runtime activation and provider benefit remain separate evidence."
    return result

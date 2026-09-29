"""Trace-backed multiple activation accounting, separate from model choices."""
import hashlib
from collections import Counter
from semantic_routing_contract import authoritative, fingerprint, validate_catalog, decode, text


def summarize_runtime(records, catalog):
    roster = validate_catalog(catalog)
    groups = {}
    seen = set()
    catalog_hash = fingerprint(catalog)
    paths = {}
    ambiguous = set()
    for skill in catalog["skills"]:
        path = skill.get("path")
        if path:
            if path in paths:
                ambiguous.add(path)
            paths[path] = skill["id"]
    for record in records:
        if not isinstance(record, dict):
            record = {}
        runtime = record.get("runtime", {})
        if not isinstance(runtime, dict):
            runtime = {}
        name = runtime.get("name")
        if not isinstance(name, str):
            name = "unknown"
        group = groups.setdefault(name, {"evidence_kind": "observed_runtime_activation", "status": "unknown", "observations": [], "unknown": [], "per_skill": {s: dict(TP=0, FP=0, FN=0, TN=0) for s in roster + ["none"]}, "confusion_pairs": []})
        try:
            if not text(record.get("case_id"), 128):
                raise ValueError("invalid case identity")
            settings = runtime.get("settings")
            if not isinstance(settings, dict) or not text(settings.get("effective_model"), 256):
                raise ValueError("effective model identity unknown")
            identity = (name, record.get("case_id"))
            if identity in seen or not authoritative(catalog):
                raise ValueError("duplicate case or unverified catalog")
            seen.add(identity)
            if runtime != catalog["runtime"] or record.get("catalog_hash") != catalog_hash or record.get("unforced") is not True:
                raise ValueError("runtime/catalog/unforced provenance mismatch")
            with open(record["trace_path"], "rb") as stream:
                raw = stream.read((1 << 20) + 1)
            if len(raw) > 1 << 20 or hashlib.sha256(raw).hexdigest() != record["trace_digest"]:
                raise ValueError("trace digest/size mismatch")
            trace = decode(raw)
            if not isinstance(trace, dict):
                raise ValueError("invalid trace")
            if trace.get("runtime") != runtime or trace.get("case_id") != record["case_id"] or trace.get("catalog_hash") != catalog_hash or trace.get("prompt_hash") != record["prompt_hash"]:
                raise ValueError("trace identity mismatch")
            observed = set()
            if not isinstance(trace.get("events"), list):
                raise ValueError("invalid trace events")
            for event in trace["events"]:
                if not isinstance(event, dict):
                    raise ValueError("invalid trace event")
                if event.get("type") == "skill_read":
                    path = event.get("path")
                    if not isinstance(path, str) or path not in paths or path in ambiguous:
                        raise ValueError("unknown or ambiguous activation path")
                    observed.add(paths[path])
                elif event.get("type") == "skill_invoke":
                    if event.get("skill_id") not in roster:
                        raise ValueError("unknown activation identity")
                    observed.add(event["skill_id"])
            if not isinstance(trace.get("complete"), bool) or not trace["complete"]:
                raise ValueError("incomplete trace")
            expected = record["expected"]
            if expected not in roster + ["none"]:
                raise ValueError("invalid expected activation")
            predictions = observed or {"none"}
            for skill, counts in group["per_skill"].items():
                actual, predicted = expected == skill, skill in predictions
                counts["TP" if actual and predicted else "FN" if actual else "FP" if predicted else "TN"] += 1
            group["observations"].append({"case_id": record["case_id"], "expected": expected, "observed": sorted(observed), "trace_digest": record["trace_digest"]})
        except (KeyError, TypeError, ValueError, OSError) as error:
            group["unknown"].append({"case_id": record.get("case_id"), "reason": str(error)[:256]})
    for name in ("claude-code", "codex", "pi"):
        groups.setdefault(name, {"evidence_kind": "observed_runtime_activation", "status": "unknown", "reason": "no trace-backed run supplied"})
    for group in groups.values():
        if "observations" not in group:
            continue
        group["status"] = "observed" if group["observations"] and not group["unknown"] else "unknown"
        for counts in group["per_skill"].values():
            counts["precision"] = counts["TP"] / (counts["TP"] + counts["FP"]) if counts["TP"] + counts["FP"] else None
            counts["recall"] = counts["TP"] / (counts["TP"] + counts["FN"]) if counts["TP"] + counts["FN"] else None
        pairs = Counter((row["expected"], skill) for row in group["observations"] for skill in (row["observed"] or ["none"]))
        group["confusion_pairs"] = [{"expected": e, "observed": s, "count": n} for (e, s), n in sorted(pairs.items())]
    return {"runtimes": groups, "semantic_evidence_used": False}

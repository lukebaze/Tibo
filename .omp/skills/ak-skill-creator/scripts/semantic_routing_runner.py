"""Sequential bounded batches and streaming per-case probability records."""
from semantic_routing_contract import (PROTOCOL, authoritative, batch_binding, batches,
    fingerprint, request, validate_cases, validate_catalog)
from semantic_routing_metrics import Metrics, classify_batch


def select_cases(document, catalog, split, freeze=None):
    cases = validate_cases(document, catalog)
    if split == "holdout":
        wanted = {"catalog_hash": fingerprint(catalog), "cases_hash": fingerprint(document), "holdout_id": document["holdout_id"], "protocol": PROTOCOL}
        if freeze != wanted:
            raise ValueError("freeze selected candidate before holdout")
    selected = [case for case in cases if case["split"] == split]
    if not selected:
        raise ValueError("selected split is empty")
    return selected


def common_schedule(document, catalogs, provider, split="train", freeze=None):
    # Go owns redaction and all encoded limits. No Python size estimate grants
    # authority: every batch in both variants passes --validate-only first.
    for size in range(8, 0, -1):
        try:
            for catalog in catalogs:
                cases = select_cases(document, catalog, split, freeze)
                for batch in batches(cases, size):
                    provider.call(request(catalog, batch), validate=True)
            return size
        except ValueError as error:
            reason = str(error)
    raise ValueError("full_catalog_case_unavailable: " + reason)


def evaluate(document, catalog, provider, batch_size=1, split="train", top_n=5, sink=None, freeze=None, envelope_sink=None):
    cases = select_cases(document, catalog, split, freeze)
    roster = validate_catalog(catalog)
    metrics = Metrics(roster)
    report = {"protocol": PROTOCOL, "evidence_kind": "diagnostic_model_choice", "status": "completed",
              "cases_hash": fingerprint(document), "catalog_hash": fingerprint(catalog), "holdout_id": document["holdout_id"], "split": split,
              "runtime": catalog["runtime"], "scope": catalog["scope"], "roster": roster,
              "catalog_metadata": {s["id"]: s for s in catalog["skills"]}, "catalog_completeness": "export-attested" if authoritative(catalog) else "unverified",
              "planned": len(cases), "completed": 0, "incomplete": 0, "batch_schedule": [], "incomplete_batches": [], "provider": None,
              "cost": None, "runtime_activation": "unknown"}
    for batch in batches(cases, batch_size):
        binding = batch_binding(catalog, batch)
        report["batch_schedule"].append(binding["case_ids"])
        try:
            if not authoritative(catalog):
                raise ValueError("catalog_completeness_unverified")
            envelope = provider.response(binding) if hasattr(provider, "response") else provider.call(request(catalog, batch))
            if envelope_sink:
                envelope_sink({"binding": binding, "envelope": envelope})
            rows, identity = classify_batch(envelope, batch, roster)
            if report["provider"] is not None and report["provider"] != identity:
                raise ValueError("provider_identity_changed")
            report["provider"] = identity
            for row in rows:
                metrics.add(row)
                row["top_competitors"] = row["top_competitors"][:top_n]
                row.update(evidence_kind="diagnostic_model_choice", catalog_hash=report["catalog_hash"], request_hash=binding["request_hash"])
                if sink:
                    sink(row)
        except (ValueError, KeyError, TypeError, OSError) as error:
            report["incomplete_batches"].append({"case_ids": binding["case_ids"], "reason": str(error)[:256]})
    if hasattr(provider, "finish"):
        try:
            provider.finish()
        except ValueError as error:
            report["incomplete_batches"].append({"case_ids": [], "reason": str(error)})
    report["completed"] = metrics.completed
    report["incomplete"] = len(cases) - metrics.completed
    report["metrics"] = metrics.report()
    if report["incomplete_batches"]:
        report["status"] = "incomplete"
    report["metrics_scope"] = "completed subset only" if report["status"] == "incomplete" else "complete selected split"
    return report

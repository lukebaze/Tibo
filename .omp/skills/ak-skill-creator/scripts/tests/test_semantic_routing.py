"""Offline contracts; generated responses are protocol fixtures, not benefit evidence."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from semantic_routing_contract import PROTOCOL, batch_binding, batches, encoded, fingerprint, request, validate_catalog
from semantic_routing_metrics import compare
from semantic_routing_providers import ReplayProvider
from semantic_routing_runner import evaluate
from semantic_routing_runtime import summarize_runtime


def catalog():
    return {"schema_version": 1, "runtime": {"name": "codex", "version": "fixture", "settings": {"effective_model": "fixture-model"}}, "scope": "fixture",
            "provenance": {"kind": "runtime-visible-export", "source": "protocol fixture", "complete": True},
            "skills": [{"id": "kit:images", "description": "Draw raster images", "path": "skills/images/SKILL.md"},
                       {"id": "kit:video", "description": "Edit video clips", "path": "skills/video/SKILL.md"}]}


def cases(count=3):
    return {"schema_version": 1, "holdout_id": "fixed-v1", "cases": [
        {"id": f"case-{i:05}", "split": "train", "prompt": f"Create a picture of a lake numbered {i}", "expected": "kit:images", "class": "positive"} for i in range(count)]}


def record(cat, batch, winner="s000"):
    return {"binding": batch_binding(cat, batch), "envelope": {"data": {"status": "completed", "profile_version": "skill-routing-v1", "provenance": {"provider": "fixture", "resolved_model": "fixture-v1"},
            "answers": {f"c{i:03}": {"kind": "choice", "choice": winner, "confidence": .8,
                "probabilities": {"s000": .8 if winner == "s000" else .1, "s001": .8 if winner == "s001" else .1, "none": .8 if winner == "none" else .1}} for i in range(len(batch))}}}}


class SemanticRoutingTests(unittest.TestCase):
    def test_ten_thousand_cases_stream_without_network_or_subprocess(self):
        cat, doc = catalog(), cases(10000)
        count = 0
        def sink(row):
            nonlocal count
            count += 1
            self.assertEqual(len(row["probabilities"]), 3)
        records = (record(cat, batch) for batch in batches(doc["cases"], 8))
        with patch("subprocess.Popen", side_effect=AssertionError("subprocess")), patch("socket.socket", side_effect=AssertionError("network")):
            result = evaluate(doc, cat, ReplayProvider(records), batch_size=8, sink=sink)
        self.assertEqual((result["status"], result["completed"], count), ("completed", 10000, 10000))
        self.assertEqual(result["metrics"]["per_skill"]["kit:images"]["TP"], 10000)
        self.assertEqual(result["runtime_activation"], "unknown")

    def test_expected_labels_local_and_replay_bound(self):
        cat, doc = catalog(), cases(1)
        before = request(cat, doc["cases"])
        old = record(cat, doc["cases"])
        doc["cases"][0]["expected"] = "none"
        self.assertEqual(before, request(cat, doc["cases"]))
        result = evaluate(doc, cat, ReplayProvider([old]))
        self.assertEqual((result["status"], result["completed"]), ("incomplete", 0))
        self.assertEqual(result["metrics"]["per_skill"]["none"]["TN"], 0)

    def test_complete_probabilities_and_extra_records_required(self):
        cat, doc = catalog(), cases(1)
        for mutation in ("probabilities", "confidence", "extra"):
            rec = record(cat, doc["cases"])
            if mutation == "probabilities":
                del rec["envelope"]["data"]["answers"]["c000"]["probabilities"]["none"]
            if mutation == "confidence":
                rec["envelope"]["data"]["answers"]["c000"]["confidence"] = float("nan")
            result = evaluate(doc, cat, ReplayProvider([rec, rec] if mutation == "extra" else [rec]))
            self.assertEqual(result["status"], "incomplete")

    def test_metadata_delta_comparison_matches_and_detects_regression(self):
        cat, doc = catalog(), cases(2)
        doc["cases"][1]["expected"] = "none"
        candidate = copy.deepcopy(cat)
        candidate["skills"][0]["description"] = "Create images, pictures and visual clips"
        before = evaluate(doc, cat, ReplayProvider(record(cat, [c], "none") for c in doc["cases"]))
        after = evaluate(doc, candidate, ReplayProvider(record(candidate, [c]) for c in doc["cases"]))
        delta = compare(before, after)
        self.assertEqual(delta["status"], "matched")
        self.assertEqual(delta["count_deltas"]["kit:images"]["TP"], 1)
        self.assertEqual(delta["count_deltas"]["kit:images"]["FP"], 1)
        self.assertNotEqual(delta["catalog_hash_before"], delta["catalog_hash_after"])
        self.assertAlmostEqual(delta["probability_deltas"]["kit:images"], .7)
        after["batch_schedule"] = []
        self.assertEqual(compare(before, after)["status"], "confounded")

    def test_holdout_requires_frozen_candidate_and_no_filesystem_authority(self):
        cat, doc = catalog(), cases(1)
        doc["cases"][0]["split"] = "holdout"
        with self.assertRaises(ValueError):
            evaluate(doc, cat, ReplayProvider([]), split="holdout")
        freeze = {"protocol": PROTOCOL, "catalog_hash": fingerprint(cat), "cases_hash": fingerprint(doc), "holdout_id": doc["holdout_id"]}
        result = evaluate(doc, cat, ReplayProvider([record(cat, doc["cases"])]), split="holdout", freeze=freeze)
        self.assertEqual(result["status"], "completed")
        cat["provenance"]["kind"] = "filesystem-scan"
        doc["cases"][0]["split"] = "train"
        self.assertEqual(evaluate(doc, cat, ReplayProvider([]))["completed"], 0)

    def test_catalog_boundary(self):
        cat = catalog()
        cat["skills"] = [{"id": f"kit:skill-{i}", "description": "Description"} for i in range(127)]
        self.assertEqual(len(validate_catalog(cat)), 127)
        cat["skills"].append({"id": "kit:extra", "description": "Description"})
        with self.assertRaises(ValueError):
            validate_catalog(cat)

    def test_runtime_trace_multiple_activation_digest_and_unknown(self):
        cat = catalog()
        trace = {"runtime": cat["runtime"], "case_id": "one", "catalog_hash": fingerprint(cat), "prompt_hash": "prompt-digest", "complete": True,
                 "events": [{"type": "skill_read", "path": "skills/images/SKILL.md"}, {"type": "skill_invoke", "skill_id": "kit:video"}]}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "trace.json"
            raw = encoded(trace)
            path.write_bytes(raw)
            rec = {k: trace[k] for k in ("runtime", "case_id", "catalog_hash", "prompt_hash")}
            rec.update(trace_path=str(path), trace_digest=hashlib.sha256(raw).hexdigest(), unforced=True, expected="kit:images")
            result = summarize_runtime([rec], cat)
            self.assertEqual(result["runtimes"]["codex"]["per_skill"]["kit:video"]["FP"], 1)
            self.assertEqual(result["runtimes"]["pi"]["status"], "unknown")
            rec["trace_digest"] = "bad"
            self.assertEqual(summarize_runtime([rec], cat)["runtimes"]["codex"]["status"], "unknown")


if __name__ == "__main__":
    unittest.main()

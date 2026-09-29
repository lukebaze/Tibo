"""Malformed provider/trace inputs must remain incomplete observations."""
import copy
import hashlib
import io
import unittest
from unittest.mock import patch
from test_semantic_routing import catalog, cases, record
from semantic_routing_contract import encoded, fingerprint
from semantic_routing_metrics import compare
from semantic_routing_providers import ReplayProvider
from semantic_routing_runner import evaluate
from semantic_routing_runtime import summarize_runtime


class RoutingValidationTests(unittest.TestCase):
    def test_nested_malformed_replay_and_incompatible_fields(self):
        cat, doc = catalog(), cases(1)
        for field in ("answers", "provenance", "answer", "data"):
            for value in (None, [], "scalar", 7):
                rec = record(cat, doc["cases"])
                data = rec["envelope"]["data"]
                if field == "answer":
                    data["answers"]["c000"] = value
                elif field == "data":
                    rec["envelope"]["data"] = value
                else:
                    data[field] = value
                self.assertEqual(evaluate(doc, cat, ReplayProvider([rec]))["status"], "incomplete")
        for field in ("score", "probability_true", "rubric"):
            rec = record(cat, doc["cases"])
            rec["envelope"]["data"]["answers"]["c000"][field] = 1
            self.assertEqual(evaluate(doc, cat, ReplayProvider([rec]))["completed"], 0)

    def test_profile_identity_required_and_matched(self):
        cat, doc = catalog(), cases(1)
        rec = record(cat, doc["cases"])
        before = evaluate(doc, cat, ReplayProvider([rec]))
        after = copy.deepcopy(before)
        after["provider"]["profile_version"] = "different"
        self.assertEqual(compare(before, after)["status"], "confounded")
        del before["provider"]["profile_version"]
        del after["provider"]["profile_version"]
        self.assertEqual(compare(before, after)["status"], "confounded")
        del rec["envelope"]["data"]["profile_version"]
        self.assertEqual(evaluate(doc, cat, ReplayProvider([rec]))["completed"], 0)

    def runtime(self, cat, events, model=None):
        trace = {"runtime": copy.deepcopy(cat["runtime"]), "case_id": "one", "catalog_hash": fingerprint(cat), "prompt_hash": "digest", "complete": True, "events": events}
        if model is not None:
            trace["runtime"]["settings"]["effective_model"] = model
        raw = encoded(trace)
        rec = {k: trace[k] for k in ("runtime", "case_id", "catalog_hash", "prompt_hash")}
        rec.update(trace_path="memory", trace_digest=hashlib.sha256(raw).hexdigest(), unforced=True, expected="none")
        with patch("builtins.open", return_value=io.BytesIO(raw)):
            return summarize_runtime([rec], cat)["runtimes"]["codex"]

    def test_unknown_and_ambiguous_activations_excluded(self):
        cat = catalog()
        for event in ({"type": "skill_read", "path": "unknown"}, {"type": "skill_invoke", "skill_id": "missing"}):
            group = self.runtime(cat, [{"type": "skill_invoke", "skill_id": "kit:images"}, event])
            self.assertEqual(group["status"], "unknown")
            self.assertEqual(group["per_skill"]["none"]["TP"], 0)
            self.assertEqual(group["observations"], [])
        cat["skills"][1]["path"] = cat["skills"][0]["path"]
        self.assertEqual(self.runtime(cat, [{"type": "skill_read", "path": cat["skills"][0]["path"]}])["status"], "unknown")

    def test_runtime_models_and_malformed_events(self):
        cat = catalog()
        for events in (None, {}, "bad", [None], [[]], ["bad"]):
            self.assertEqual(self.runtime(cat, events)["status"], "unknown")
        self.assertEqual(self.runtime(cat, [], model="different")["status"], "unknown")
        cat["runtime"]["settings"] = {}
        self.assertEqual(self.runtime(cat, [])["status"], "unknown")

"""Compression fixtures test contract behavior, never model performance claims."""

import copy
import json
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compression_evaluator import evaluate_compression, evaluate_response, generate_probes
from compression_probes import Probe, ProbeType, binding, load_probes, probe_record

SOURCE = [{"role": "user", "content": "Keep TLS verification enabled.\n"
           "Modified src/tls.py; tests pending.\nNext step: run TLS regression tests."}]
SUMMARY = "Keep TLS verification enabled. src/tls.py modified; next run TLS regression tests."


def rubric():
    return [
        Probe(ProbeType.CONSTRAINT, "TLS constraint?", "Keep TLS verification enabled.",
              "Keep TLS verification enabled.", "tls", True, True),
        Probe(ProbeType.ARTIFACT, "Artifact state?", "src/tls.py modified; tests pending",
              "Modified src/tls.py; tests pending.", "artifact", False, True),
        Probe(ProbeType.CONTINUATION, "Next action?", "Run TLS regression tests",
              "Next step: run TLS regression tests.", "next", False, True),
    ]


def grades(summary=SUMMARY):
    return {"schema_version": 1, **binding(SOURCE, summary, rubric()),
            "judge": {"id": "fixture-reviewer", "method": "manual review"},
            "results": [
                {"probe_id": "tls", "response": "Keep TLS verification enabled.",
                 "evidence": "Summary explicitly preserves verification.",
                 "scores": {"accuracy": 1, "instruction_following": 1}},
                {"probe_id": "artifact", "response": "src/tls.py is modified; tests remain pending",
                 "evidence": "Summary names src/tls.py and says tests are next.",
                 "scores": {"accuracy": 1, "artifact_trail": 1}},
                {"probe_id": "next", "response": "Run TLS regression tests",
                 "evidence": "Summary says next run TLS regression tests.",
                 "scores": {"continuity": 1, "context_awareness": 1}},
            ]}


def test_negation_never_generates_semantic_score():
    probe = rubric()[0]
    response = "Do not keep TLS verification enabled."
    lexical = evaluate_response(probe, response)
    assert lexical["exact_text_present"] is True
    assert lexical["semantic_score"] is None
    report = evaluate_compression(SOURCE, response)
    assert report.quality_score is None
    assert report.quality_status == "ungraded"
    assert all(score is None for score in report.dimension_scores.values())
    assert report.probe_results == []


def test_error_words_are_only_source_observations():
    report = evaluate_compression(["Error: earlier test failed"], "error failed")
    assert report.quality_score is None
    assert report.lexical_evidence[0]["evidence_type"] == "lexical_only"


def test_candidates_are_exact_reviewable_source_with_no_fake_truth():
    probes = generate_probes(SOURCE)
    assert {p.type for p in probes} >= {ProbeType.CONSTRAINT, ProbeType.ARTIFACT, ProbeType.CONTINUATION}
    assert all(not p.reviewed and p.context_reference == p.ground_truth for p in probes)
    assert generate_probes(["hello"]) == []
    assert generate_probes([]) == []


@pytest.mark.parametrize("messages,summary", [([], ""), ([""], ""), (SOURCE, "")])
def test_empty_context_stays_ungraded(messages, summary):
    report = evaluate_compression(messages, summary)
    assert report.quality_score is None
    assert report.coverage["graded_probes"] == 0
    if not any(messages):
        assert report.compression_ratio is None


def test_external_constraint_continuation_and_artifact_are_attributable():
    report = evaluate_compression(SOURCE, SUMMARY, rubric(), grades())
    assert report.quality_score == 1
    assert report.quality_status == "externally_graded"
    assert report.dimension_scores["completeness"] is None
    assert report.coverage["fraction"] == 1
    assert report.coverage["critical_probes"] == 1
    assert report.judge == grades()["judge"]
    assert report.probe_results[1]["evidence"] == grades()["results"][1]["evidence"]


def test_critical_failure_cannot_be_averaged_away():
    summary = "Do not keep TLS verification enabled. src/tls.py; run TLS tests."
    data = grades(summary)
    data["results"][0].update(response="Disable TLS verification", evidence="Summary reverses keep with Do not.")
    data["results"][0]["scores"] = {"accuracy": 0, "instruction_following": 0}
    report = evaluate_compression(SOURCE, summary, rubric(), data)
    assert report.quality_score == 0
    assert report.graded_mean_score == pytest.approx(2 / 3)
    assert report.critical_constraint_failures == ["tls"]
    assert report.quality_status == "failed_critical_constraint"


@pytest.mark.parametrize("mutate", [
    lambda d: d["results"].pop(0),
    lambda d: d["results"].append(copy.deepcopy(d["results"][0])),
    lambda d: d["results"][0].update(probe_id="unexpected"),
    lambda d: d["results"][0]["scores"].pop("instruction_following"),
    lambda d: d["results"][0]["scores"].update(completeness=1),
    lambda d: d["results"][0].update(evidence=""),
    lambda d: d["results"][0].update(response=""),
    lambda d: d.update(judge={"id": "", "method": "manual"}),
    lambda d: d.update(schema_version=True),
    lambda d: d.update(results=[]),
])
def test_incomplete_or_invalid_grades_are_rejected(mutate):
    data = grades()
    mutate(data)
    with pytest.raises(ValueError):
        evaluate_compression(SOURCE, SUMMARY, rubric(), data)


@pytest.mark.parametrize("score", [float("nan"), float("inf"), -float("inf"), -1, 2, True, "1", None])
def test_invalid_scores_are_rejected(score):
    data = grades()
    data["results"][0]["scores"]["accuracy"] = score
    with pytest.raises(ValueError):
        evaluate_compression(SOURCE, SUMMARY, rubric(), data)


@pytest.mark.parametrize("key", ["source_sha256", "summary_sha256", "probes_sha256"])
def test_mismatched_binding_is_rejected(key):
    data = grades()
    data[key] = "0" * 64
    with pytest.raises(ValueError, match="does not match"):
        evaluate_compression(SOURCE, SUMMARY, rubric(), data)


def test_changed_rubric_and_unreviewed_candidates_are_rejected():
    probes = rubric()
    probes[0].critical = False
    with pytest.raises(ValueError, match="probes_sha256"):
        evaluate_compression(SOURCE, SUMMARY, probes, grades())
    probes = rubric()
    probes[0].reviewed = False
    with pytest.raises(ValueError, match="reviewed"):
        evaluate_compression(SOURCE, SUMMARY, probes, grades())


@pytest.mark.parametrize("messages", [{}, None, [1], [{"content": []}], [{"role": "user"}]])
def test_invalid_source_rejected(messages):
    with pytest.raises(ValueError):
        evaluate_compression(messages, SUMMARY)


def test_invalid_source_reference_rejected():
    records = [probe_record(p) for p in rubric()]
    records[0]["context_reference"] = "not in source"
    with pytest.raises(ValueError, match="absent from source"):
        load_probes(records, SOURCE)


@pytest.mark.parametrize("field", ["critical", "reviewed"])
def test_rubric_requires_explicit_review_and_critical_designation(field):
    records = [probe_record(p) for p in rubric()]
    records[0].pop(field)
    with pytest.raises(ValueError, match="explicitly declare"):
        load_probes(records, SOURCE)


def test_empty_rubric_and_nonfinite_judge_metadata_rejected():
    with pytest.raises(ValueError, match="nonempty"):
        evaluate_compression(SOURCE, SUMMARY, [], grades())
    data = grades()
    data["judge"]["temperature"] = float("nan")
    with pytest.raises(ValueError):
        evaluate_compression(SOURCE, SUMMARY, rubric(), data)


def test_empty_ground_truth_has_no_lexical_match():
    evidence = evaluate_response(Probe(ProbeType.RECALL, "question", ""), "anything")
    assert evidence["exact_text_present"] is False
    assert evidence["word_overlap_fraction"] is None
    assert evidence["semantic_score"] is None

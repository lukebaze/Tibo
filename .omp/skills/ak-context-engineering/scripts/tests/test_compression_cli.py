"""Offline compression CLI contract and input failures."""

import json
from pathlib import Path
import subprocess
import sys

import pytest

from test_compression_quality import SOURCE, SUMMARY, grades, rubric
from compression_probes import probe_record

SCRIPT = Path(__file__).resolve().parents[1] / "compression_evaluator.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                          capture_output=True, text=True, timeout=10)


def inputs(tmp_path):
    paths = [tmp_path / name for name in ("source.json", "summary.txt", "probes.json", "grades.json")]
    for path, value in zip(paths, (SOURCE, SUMMARY, [probe_record(p) for p in rubric()], grades())):
        path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")
    return paths


def test_cli_default_and_explicit_grade(tmp_path):
    source, summary, probes, grade = inputs(tmp_path)
    default = run("evaluate", source, summary)
    assert default.returncode == 0, default.stderr
    report = json.loads(default.stdout)
    assert report["schema_version"] == 2
    assert report["quality_score"] is None
    assert report["quality_status"] == "ungraded"
    graded = run("evaluate", source, summary, "--probes", probes, "--grades", grade)
    assert graded.returncode == 0, graded.stderr
    assert json.loads(graded.stdout)["quality_score"] == 1


def test_cli_generate_candidates_and_required_rubric(tmp_path):
    source, summary, probes, grade = inputs(tmp_path)
    result = run("generate-probes", source)
    assert result.returncode == 0, result.stderr
    assert all(p["reviewed"] is False for p in json.loads(result.stdout))
    result = run("evaluate", source, summary, "--grades", grade)
    assert result.returncode == 1
    assert "--grades requires --probes" in result.stderr


@pytest.mark.parametrize("data", ["{}", "null", "1", '{"messages": null}', '[{"content": null}]'])
def test_cli_bad_source_shape(tmp_path, data):
    source, summary, _, _ = inputs(tmp_path)
    source.write_text(data)
    result = run("evaluate", source, summary)
    assert result.returncode == 1
    assert "Error:" in result.stderr
    assert "Traceback" not in result.stderr


def test_empty_summary_cannot_receive_external_grade(tmp_path):
    source, summary, probes, grade = inputs(tmp_path)
    summary.write_text("")
    result = run("evaluate", source, summary, "--probes", probes, "--grades", grade)
    assert result.returncode == 1
    assert "nonempty source and summary" in result.stderr


def test_summary_line_endings_are_bound_exactly(tmp_path):
    source, summary, probes, grade = inputs(tmp_path)
    summary.write_bytes((SUMMARY + "\r\n").encode())
    result = run("evaluate", source, summary, "--probes", probes, "--grades", grade)
    assert result.returncode == 1
    assert "summary_sha256" in result.stderr


def test_bad_utf8_reports_error(tmp_path):
    source, summary, _, _ = inputs(tmp_path)
    summary.write_bytes(b"\xff")
    result = run("evaluate", source, summary)
    assert result.returncode == 1
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("data", ['{"messages": [], "messages": []}',
                                  '{"messages": [], "metadata": NaN}',
                                  '{"messages": [], "metadata": Infinity}'])
def test_ambiguous_or_nonfinite_json_rejected(tmp_path, data):
    source, summary, _, _ = inputs(tmp_path)
    source.write_text(data)
    result = run("evaluate", source, summary)
    assert result.returncode == 1
    assert "Error:" in result.stderr
    assert "Traceback" not in result.stderr

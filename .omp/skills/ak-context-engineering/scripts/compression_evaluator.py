#!/usr/bin/env python3
"""Offline compression diagnostics; semantic scores require attributable external grades.

Usage:
    python compression_evaluator.py evaluate original.json summary.txt
    python compression_evaluator.py evaluate original.json summary.txt --probes probes.json --grades grades.json
    python compression_evaluator.py generate-probes original.json
"""

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Optional

from compression_grades import DIMENSIONS, validate_grades
from compression_probes import (Probe, ProbeType, binding,
                                evaluate_response, generate_probes, load_probes,
                                message_text, probe_record, validate_messages)

MAX_FILE_SIZE_MB = 100


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def load_file(path: str, as_json: bool = True):
    """Load bounded UTF-8 input; report errors without a traceback."""
    try:
        size_mb = os.path.getsize(path) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            raise ValueError(f"File too large ({size_mb:.1f}MB). Max {MAX_FILE_SIZE_MB}MB")
        with open(path, encoding="utf-8", newline="") as stream:
            return (json.load(stream, object_pairs_hook=unique_object,
                              parse_constant=reject_constant) if as_json else stream.read())
    except FileNotFoundError:
        raise ValueError(f"File not found: {path}") from None
    except PermissionError:
        raise ValueError(f"Permission denied: {path}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc


@dataclass
class EvaluationReport:
    compression_ratio: Optional[float]
    quality_score: Optional[float] = None
    dimension_scores: dict = field(default_factory=lambda: {d: None for d in DIMENSIONS})
    probe_results: list = field(default_factory=list)
    recommendations: list = field(default_factory=list)
    quality_status: str = "ungraded"
    graded_mean_score: Optional[float] = None
    lexical_evidence: list = field(default_factory=list)
    input_binding: dict = field(default_factory=dict)
    coverage: dict = field(default_factory=dict)
    critical_constraint_failures: list = field(default_factory=list)
    judge: Optional[dict] = None
    token_estimate_method: str = "ceil(characters/4); not a tokenizer measurement"
    score_scope: str = "External judge claims over the supplied rubric, not independent semantic verification"


def estimate_tokens(text: str) -> int:
    return (len(text) + 3) // 4


def calculate_compression_ratio(original: str, compressed: str) -> Optional[float]:
    """Estimate token reduction; undefined when the original has no text."""
    original_tokens = estimate_tokens(original)
    return 1 - estimate_tokens(compressed) / original_tokens if original_tokens else None


def evaluate_compression(original_messages: list, compressed_text: str,
                         probes: Optional[list] = None, grades=None) -> EvaluationReport:
    original_messages = validate_messages(original_messages)
    if not isinstance(compressed_text, str):
        raise ValueError("Compressed summary must be text")
    if probes is None:
        probes = generate_probes(original_messages)
    else:
        probes = load_probes([probe_record(p) for p in probes], original_messages)
    hashes = binding(original_messages, compressed_text, probes)
    report = EvaluationReport(
        compression_ratio=calculate_compression_ratio(message_text(original_messages), compressed_text),
        lexical_evidence=[{"probe_id": p.id, **evaluate_response(p, compressed_text)} for p in probes],
        input_binding=hashes,
        coverage={"total_probes": len(probes), "graded_probes": 0,
                  "fraction": 0.0 if probes else None,
                  "critical_probes": sum(p.critical for p in probes),
                  "scope": "candidate or supplied rubric; source completeness is not automatically verified"},
        recommendations=["Review source constraints, artifact state, and continuation criteria before external grading."],
    )
    if grades is not None:
        if not message_text(original_messages).strip() or not compressed_text.strip():
            raise ValueError("External grades require nonempty source and summary")
        result = validate_grades(grades, hashes, probes)
        for key, value in result.items():
            setattr(report, key, value)
        report.recommendations = (["Critical constraints failed; do not accept this compression."]
                                  if report.critical_constraint_failures else [])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    evaluate = commands.add_parser("evaluate", help="Report lexical evidence and optional external grades")
    evaluate.add_argument("original_file")
    evaluate.add_argument("compressed_file")
    evaluate.add_argument("--probes", help="Reviewed JSON probe list")
    evaluate.add_argument("--grades", help="External JSON results bound to source, summary and probes")
    generate = commands.add_parser("generate-probes", help="Generate unreviewed candidates, not established truth")
    generate.add_argument("context_file")
    args = parser.parse_args()
    try:
        if args.command == "evaluate":
            messages = validate_messages(load_file(args.original_file))
            compressed = load_file(args.compressed_file, as_json=False)
            probes = load_probes(load_file(args.probes), messages) if args.probes else None
            if args.grades and not args.probes:
                raise ValueError("--grades requires --probes with a reviewed rubric")
            report = evaluate_compression(messages, compressed, probes,
                                          load_file(args.grades) if args.grades else None)
            output = asdict(report)
            output.update(schema_version=2, probe_count=report.coverage["total_probes"])
        else:
            messages = validate_messages(load_file(args.context_file))
            output = [probe_record(p) for p in generate_probes(messages)]
        print(json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False))
    except (ValueError, TypeError, OSError, UnicodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

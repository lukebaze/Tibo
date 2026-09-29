#!/usr/bin/env python3
"""Estimate file size, inspect context capacity, and plan task token allocations.

All estimates are approximate, not tokenizer counts or model-quality measurements.
Run a subcommand with --help for supported inputs. No credential/runtime access.
"""
import argparse
import json
import os
import sys

from context_budget import add_budget_arguments, budget_from_args, calculate_budget
from context_health import analyze_context, estimate_tokens, load_messages

MAX_FILE_SIZE_MB = 100

# Read-strategy thresholds for `estimate` (tokens). Files at or under WHOLE fit in
# one read; up to RANGES they should be searched then read by line range; larger
# files should be searched first and read only around the hits.
ESTIMATE_WHOLE_MAX = 2000
ESTIMATE_RANGES_MAX = 8000
ESTIMATE_MAX_FILES = 500
ESTIMATE_SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target"}


def read_advice(tokens: int) -> str:
    """Map an estimated token count to a read strategy."""
    if tokens <= ESTIMATE_WHOLE_MAX:
        return "read-whole"
    if tokens <= ESTIMATE_RANGES_MAX:
        return "search-then-ranges"
    return "search-first"


def collect_files(paths: list) -> tuple:
    """Expand files and directories into a bounded file list. Returns (files, errors)."""
    files, errors = [], []
    for raw in paths:
        if os.path.isfile(raw):
            files.append(raw)
            continue
        if not os.path.isdir(raw):
            errors.append(f"Path not found: {raw}")
            continue
        for root, dirs, names in os.walk(raw):
            dirs[:] = sorted(d for d in dirs if d not in ESTIMATE_SKIP_DIRS and not d.startswith("."))
            for name in sorted(names):
                files.append(os.path.join(root, name))
                if len(files) >= ESTIMATE_MAX_FILES:
                    errors.append(f"Stopped after {ESTIMATE_MAX_FILES} files; narrow the path")
                    return files, errors
    return files, errors


def estimate_file(path: str) -> dict:
    """Estimate tokens for one file. Oversized, binary, and unreadable files are
    sized without being decoded, instead of raising and losing every other file's
    result in the same `estimate` run."""
    try:
        size = os.path.getsize(path)
    except OSError as e:
        return {"path": path, "bytes": None, "lines": None, "tokens": 0, "advice": "unreadable", "error": str(e)}
    if size > MAX_FILE_SIZE_MB * 1024 * 1024:
        # Too large to safely decode whole; size-only estimate still guides the read strategy.
        return {"path": path, "bytes": size, "lines": None, "tokens": size // 4, "advice": "search-first"}
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except UnicodeDecodeError:
        return {"path": path, "bytes": size, "lines": None, "tokens": 0, "advice": "binary-skip"}
    except OSError as e:
        return {"path": path, "bytes": size, "lines": None, "tokens": 0, "advice": "unreadable", "error": str(e)}
    tokens = estimate_tokens(text)
    lines = text.count(chr(10)) + (1 if text and not text.endswith(chr(10)) else 0)
    return {"path": path, "bytes": size, "lines": lines, "tokens": tokens, "advice": read_advice(tokens)}


def estimate_paths(paths: list, limit: int = 200000) -> dict:
    """Estimate tokens for files/directories and advise a read strategy per file."""
    files, errors = collect_files(paths)
    entries = [estimate_file(f) for f in files]
    total = sum(e["tokens"] for e in entries)
    return {
        "files": entries,
        "total_tokens": total,
        "token_limit": limit,
        "percent_of_limit": round(total / limit * 100, 1) if limit > 0 else None,
        "thresholds": {"read_whole_max": ESTIMATE_WHOLE_MAX, "search_then_ranges_max": ESTIMATE_RANGES_MAX},
        "errors": errors,
        "measurement": "estimated-characters-divided-by-four",
        "scope": "supplied-files-only; limit is a comparison assumption, not runtime telemetry",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="Capacity and lexical diagnostics, not quality")
    analyze.add_argument("context_file")
    analyze.add_argument("--limit", type=int, help="Verified model context window")
    analyze.add_argument("--used-tokens", type=int, help="Runtime-reported context usage")
    analyze.add_argument("--next-step", type=int, default=0)
    analyze.add_argument("--output-reserve", type=int, default=0)
    analyze.add_argument("--checkpoint-reserve", type=int, default=0)
    analyze.add_argument("--keywords", nargs="+")
    add_budget_arguments(commands.add_parser("budget", help="Separate capacity and cumulative spend"))
    estimate = commands.add_parser("estimate", help="Approximate file sizes; not live session usage")
    estimate.add_argument("paths", nargs="+")
    estimate.add_argument("--limit", type=int, default=200000,
                          help="Comparison size only (default assumption: 200000)")
    args = parser.parse_args()
    try:
        if args.command == "analyze":
            result = analyze_context(load_messages(args.context_file, MAX_FILE_SIZE_MB),
                args.limit, args.keywords, used_tokens=args.used_tokens,
                next_step=args.next_step, output_reserve=args.output_reserve,
                checkpoint_reserve=args.checkpoint_reserve)
        elif args.command == "budget":
            result = budget_from_args(args)
        else:
            if args.limit < 0:
                raise ValueError("limit must be nonnegative")
            result = estimate_paths(args.paths, args.limit)
        print(json.dumps(result, indent=2, allow_nan=False))
        if args.command == "estimate":
            for error in result["errors"]:
                print(f"Error: {error}", file=sys.stderr)
            if result["errors"] and not result["files"]:
                return 1
        return 0
    except FileNotFoundError as error:
        print(f"Error: File not found: {error.filename}", file=sys.stderr)
        return 1
    except (ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Optional semantic regression diagnostics; existing eval_skill.py is unchanged."""
import argparse
import json
import sys
from pathlib import Path
from semantic_routing_contract import (PROTOCOL, encoded, fingerprint, load,
    validate_catalog)
from semantic_routing_metrics import compare
from semantic_routing_providers import DecisionCLIProvider, ReplayProvider, replay_records
from semantic_routing_runner import common_schedule, evaluate, select_cases
from semantic_routing_runtime import summarize_runtime


def write_new(path, value):
    with open(path, "x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser("snapshot", help="freeze an actual runtime-visible export; never infer filesystem completeness")
    snapshot.add_argument("--export", required=True)
    snapshot.add_argument("--output", required=True)
    freeze = commands.add_parser("freeze", help="freeze selected candidate before accessing holdout")
    schedule = commands.add_parser("schedule", help="find common full-catalog batch size using offline Go validation")
    for sub in (freeze, schedule):
        sub.add_argument("--catalog", required=True)
        sub.add_argument("--cases", required=True)
        sub.add_argument("--output", required=True)
    schedule.add_argument("--candidate-catalog")
    schedule.add_argument("--ak", default="ak")
    for mode in ("run", "replay"):
        sub = commands.add_parser(mode)
        for name in ("catalog", "cases", "output"):
            sub.add_argument("--" + name, required=True)
        sub.add_argument("--split", choices=("train", "holdout"), default="train")
        sub.add_argument("--freeze")
        sub.add_argument("--batch-size", type=int, default=1)
        sub.add_argument("--top-n", type=int, default=5)
        if mode == "run":
            sub.add_argument("--live", action="store_true")
            sub.add_argument("--ak", default="ak")
        else:
            sub.add_argument("--responses", required=True)
    diff = commands.add_parser("compare")
    diff.add_argument("--baseline", required=True)
    diff.add_argument("--candidate", required=True)
    diff.add_argument("--output", required=True)
    runtime = commands.add_parser("summarize")
    runtime.add_argument("--records", nargs="+", required=True)
    runtime.add_argument("--catalog", required=True)
    runtime.add_argument("--output", required=True)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "snapshot":
            result = load(args.export)
            validate_catalog(result)
        elif args.command == "compare":
            result = compare(load(args.baseline), load(args.candidate))
        elif args.command == "summarize":
            result = summarize_runtime([load(path) for path in args.records], load(args.catalog))
        else:
            catalog, cases = load(args.catalog), load(args.cases)
            validate_catalog(catalog)
            if args.command == "freeze":
                select_cases(cases, catalog, "train")
                result = {"protocol": PROTOCOL, "catalog_hash": fingerprint(catalog), "cases_hash": fingerprint(cases), "holdout_id": cases["holdout_id"]}
            elif args.command == "schedule":
                catalogs = [catalog] + ([load(args.candidate_catalog)] if args.candidate_catalog else [])
                size = common_schedule(cases, catalogs, DecisionCLIProvider(args.ak))
                result = {"batch_size": size, "catalog_hashes": [fingerprint(c) for c in catalogs], "cases_hash": fingerprint(cases), "protocol": PROTOCOL}
            else:
                if not 1 <= args.top_n <= 128:
                    raise ValueError("top-n must be 1..128")
                freeze = load(args.freeze) if args.freeze else None
                if args.command == "run":
                    if not args.live:
                        raise ValueError("run requires explicit --live; use replay for offline diagnostics")
                    provider = DecisionCLIProvider(args.ak, live=True)
                    from semantic_routing_contract import batches, request
                    # Validate every payload before the first paid call.
                    for batch in batches(select_cases(cases, catalog, args.split, freeze), args.batch_size):
                        provider.call(request(catalog, batch), validate=True)
                else:
                    provider = ReplayProvider(replay_records(args.responses))
                if Path(args.output).exists():
                    raise ValueError("output already exists")
                records_path = args.output + ".records.jsonl"
                with open(records_path, "x", encoding="utf-8") as records, open(args.output + ".envelopes.jsonl", "x", encoding="utf-8") as envelopes:
                    def sink(row):
                        records.write(encoded(row).decode() + "\n")
                        records.flush()
                    def envelope_sink(row):
                        envelopes.write(encoded(row).decode() + "\n")
                        envelopes.flush()
                    result = evaluate(cases, catalog, provider, args.batch_size, args.split, args.top_n, sink, freeze, envelope_sink)
                result["records_path"] = records_path
        write_new(args.output, result)
        return 1 if result.get("status") in ("incomplete", "confounded") else 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({"status": "incomplete", "evidence_kind": "diagnostic_model_choice", "reason": str(error)[:256]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

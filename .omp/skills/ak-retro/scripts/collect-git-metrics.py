#!/usr/bin/env python3
"""Collect one bounded Git history snapshot for portable retrospective metrics."""

import argparse
import json
import subprocess
from collections import Counter


def collect(since, until, repo):
    def git_metadata(*args):
        return subprocess.run(
            ["git", "-C", repo, "rev-parse", *args], check=True,
            capture_output=True, encoding="utf-8",
        ).stdout.strip()

    head_revision = git_metadata("--verify", "HEAD")
    is_shallow = git_metadata("--is-shallow-repository") == "true"
    result = subprocess.run(
        ["git", "-C", repo, "log", f"--since={since}", f"--until={until}",
         "--numstat", "--no-renames", "--format=%x1e%H%x1f%cI%x1f%aN%x1f%P%x1f%s",
         head_revision, "--"],
        check=True, capture_output=True, encoding="utf-8",
    )
    commits = []
    days, authors, types, files = Counter(), Counter(), Counter(), Counter()
    added = removed = binary = test_changes = 0
    for record in result.stdout.split("\x1e"):
        if not record.strip():
            continue
        header, *rows = record.strip().splitlines()
        sha, timestamp, author, parents, subject = header.split("\x1f", 4)
        commits.append({"sha": sha, "date": timestamp, "author": author,
                        "parents": parents.split(), "subject": subject})
        days[timestamp[:10]] += 1
        authors[author] += 1
        types[subject.split(":", 1)[0].split("(", 1)[0]] += 1
        for row in rows:
            columns = row.split("\t", 2)
            if len(columns) != 3:
                continue
            ins, dels, path = columns
            files[path] += 1
            test_changes += int(any(token in path for token in
                                    (".test.", ".spec.", "__tests__", "test_", "_test.")))
            if ins == "-" or dels == "-":
                binary += 1
            else:
                added += int(ins)
                removed += int(dels)
    return {"since": since, "until": until, "head_revision": head_revision,
            "is_shallow_repository": is_shallow, "commits": commits,
            "commits_per_day": dict(days), "authors": dict(authors),
            "commit_types": dict(types), "file_changes": dict(files),
            "added": added, "removed": removed, "net": added - removed,
            "binary_changes": binary, "test_file_changes": test_changes,
            "merge_commits": sum(len(c["parents"]) > 1 for c in commits),
            "date_policy": "Git committer-date range; days retain each committer timestamp offset",
            "test_file_policy": "Path-name heuristic: .test., .spec., __tests__, test_, or _test.; not executed coverage",
            "diff_policy": "Git default merge diff; renames counted as delete/add",
            "path_policy": "Git quoted display paths retained"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", required=True, help="Explicit ISO start timestamp")
    parser.add_argument("--until", required=True, help="Explicit ISO end timestamp")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()
    print(json.dumps(collect(args.since, args.until, args.repo), ensure_ascii=True, indent=2))

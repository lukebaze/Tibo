"""Verify retrospective evidence against a real disposable Git history."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "collect-git-metrics.py"
SPEC = importlib.util.spec_from_file_location("git_metrics", SOURCE)
METRICS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(METRICS)


class GitMetricsTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="ak-retro-test-")
        self.addCleanup(self.scratch.cleanup)
        self.repo = Path(self.scratch.name) / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture Author")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.autocrlf", "false")
        (self.repo / "example.py").write_text("first\n", encoding="utf-8")
        self.commit("feat: initial", "2026-09-01T12:00:00+07:00")
        (self.repo / "example.py").write_text("first\nsecond\n", encoding="utf-8")
        (self.repo / "test_example.py").write_text("test line\n", encoding="utf-8")
        (self.repo / "example_test.go").write_text("package example\n", encoding="utf-8")
        (self.repo / "binary.dat").write_bytes(b"\x00\x01\x02")
        self.commit("test: coverage", "2026-09-02T12:00:00+07:00",
                    author_date="2025-01-01T00:00:00+00:00")

    def git(self, *args, env=None):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              capture_output=True, encoding="utf-8", env=env).stdout.strip()

    def commit(self, subject, date, author_date=None):
        self.git("add", "--all")
        env = dict(os.environ, GIT_AUTHOR_DATE=author_date or date, GIT_COMMITTER_DATE=date)
        self.git("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
                 "commit", "-qm", subject, env=env)

    def collect(self, since="2026-09-01T00:00:00+07:00", until="2026-09-03T00:00:00+07:00", repo=None):
        return METRICS.collect(since, until, str(repo or self.repo))

    def test_snapshot_totals_and_provenance(self):
        result = self.collect()
        self.assertEqual(len(result["commits"]), 2)
        self.assertEqual((result["added"], result["removed"], result["net"]), (4, 0, 4))
        self.assertEqual(result["binary_changes"], 1)
        self.assertEqual(result["test_file_changes"], 2)
        self.assertEqual(result["file_changes"]["example.py"], 2)
        self.assertEqual(result["head_revision"], self.git("rev-parse", "HEAD"))
        self.assertFalse(result["is_shallow_repository"])
        self.assertEqual(result["commits_per_day"], {"2026-09-02": 1, "2026-09-01": 1})
        self.assertIn("committer", result["date_policy"])

    def test_range_uses_committer_date_even_when_author_date_differs(self):
        result = self.collect(since="2026-09-02T00:00:00+07:00")
        self.assertEqual([c["subject"] for c in result["commits"]], ["test: coverage"])
        self.assertEqual(result["commits"][0]["date"], "2026-09-02T12:00:00+07:00")

    def test_empty_period_is_zero_with_revision(self):
        result = self.collect(since="2027-01-01T00:00:00Z", until="2027-01-02T00:00:00Z")
        self.assertEqual(result["commits"], [])
        self.assertEqual(result["added"], 0)
        self.assertTrue(result["head_revision"])

    def test_shallow_history_is_marked_incomplete(self):
        clone = Path(self.scratch.name) / "shallow"
        subprocess.run(["git", "-c", "protocol.file.allow=always", "clone", "-q",
                        "--depth=1", self.repo.as_uri(), str(clone)], check=True, capture_output=True)
        result = self.collect(repo=clone)
        self.assertTrue(result["is_shallow_repository"])
        self.assertEqual(len(result["commits"]), 1)

    def test_invalid_repository_is_not_zero_activity(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.collect(repo=Path(self.scratch.name) / "missing")


if __name__ == "__main__":
    unittest.main()

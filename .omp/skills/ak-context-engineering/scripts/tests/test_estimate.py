"""Tests for the `estimate` subcommand of context_analyzer.py.

Covers read-strategy advice thresholds, directory walking with skip rules,
binary handling, missing paths, and the JSON output contract.
"""

import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent
PYTHON = sys.executable
sys.path.insert(0, str(SCRIPTS_DIR))

import context_analyzer as ca  # noqa: E402


def run_estimate(*args, timeout=30):
    cmd = [PYTHON, str(SCRIPTS_DIR / "context_analyzer.py"), "estimate"] + list(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


class TestReadAdvice:
    def test_small_file_read_whole(self):
        assert ca.read_advice(ca.ESTIMATE_WHOLE_MAX) == "read-whole"

    def test_medium_file_search_then_ranges(self):
        assert ca.read_advice(ca.ESTIMATE_WHOLE_MAX + 1) == "search-then-ranges"
        assert ca.read_advice(ca.ESTIMATE_RANGES_MAX) == "search-then-ranges"

    def test_large_file_search_first(self):
        assert ca.read_advice(ca.ESTIMATE_RANGES_MAX + 1) == "search-first"


class TestEstimateCommand:
    def test_single_small_file(self, tmp_path):
        f = tmp_path / "small.md"
        f.write_text("hello world\n" * 10, encoding="utf-8")
        result = run_estimate(str(f))
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert len(data["files"]) == 1
        entry = data["files"][0]
        assert entry["advice"] == "read-whole"
        assert entry["lines"] == 10
        assert entry["tokens"] == len("hello world\n" * 10) // 4
        assert data["total_tokens"] == entry["tokens"]
        assert data["token_limit"] == 200000
        assert data["errors"] == []

    def test_large_file_advises_search_first(self, tmp_path):
        f = tmp_path / "big.py"
        f.write_text("x = 1\n" * 10000, encoding="utf-8")  # ~15k tokens
        data = json.loads(run_estimate(str(f)).stdout)
        assert data["files"][0]["advice"] == "search-first"

    def test_directory_walk_skips_noise_dirs(self, tmp_path):
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "a.py").write_text("print(1)\n", encoding="utf-8")
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "dep.js").write_text("module.exports = 1\n", encoding="utf-8")
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        data = json.loads(run_estimate(str(tmp_path)).stdout)
        paths = [Path(e["path"]).name for e in data["files"]]
        assert paths == ["a.py"]

    def test_binary_file_reported_not_decoded(self, tmp_path):
        f = tmp_path / "blob.bin"
        f.write_bytes(bytes([0xFF, 0xFE, 0x00, 0x80]) * 100)
        data = json.loads(run_estimate(str(f)).stdout)
        assert data["files"][0]["advice"] == "binary-skip"
        assert data["files"][0]["tokens"] == 0

    def test_missing_path_exits_1(self):
        result = run_estimate("/this/path/does/not/exist")
        assert result.returncode == 1
        assert "Path not found" in result.stderr

    def test_missing_path_alongside_valid_is_reported(self, tmp_path):
        f = tmp_path / "ok.txt"
        f.write_text("ok\n", encoding="utf-8")
        result = run_estimate(str(f), "/missing/file.txt")
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert len(data["files"]) == 1
        assert any("Path not found" in e for e in data["errors"])
        # Errors always surface on stderr, even on a successful (exit 0) partial result.
        assert "Path not found" in result.stderr

    def test_custom_limit_percent(self, tmp_path):
        f = tmp_path / "f.txt"
        f.write_text("a" * 4000, encoding="utf-8")  # 1000 tokens
        data = json.loads(run_estimate(str(f), "--limit", "10000").stdout)
        assert data["total_tokens"] == 1000
        assert data["percent_of_limit"] == 10.0

    def test_zero_limit_percent_is_none(self, tmp_path):
        f = tmp_path / "f.txt"
        f.write_text("a" * 40, encoding="utf-8")
        data = json.loads(run_estimate(str(f), "--limit", "0").stdout)
        assert data["percent_of_limit"] is None

    def test_utf8_content(self, tmp_path):
        f = tmp_path / "vi.md"
        f.write_text("Xin chào thế giới 🌍\n", encoding="utf-8")
        result = run_estimate(str(f))
        assert result.returncode == 0
        assert json.loads(result.stdout)["files"][0]["lines"] == 1


class TestEstimateExitCodeContract:
    """A legitimate empty result must not look like a failure (C4)."""

    def test_empty_directory_exits_0_with_no_stderr(self, tmp_path):
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        result = run_estimate(str(empty_dir))
        assert result.returncode == 0
        assert result.stderr == ""
        data = json.loads(result.stdout)
        assert data["files"] == []
        assert data["errors"] == []

    def test_directory_of_only_skipped_dirs_exits_0(self, tmp_path):
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "x.js").write_text("1\n", encoding="utf-8")
        result = run_estimate(str(tmp_path))
        assert result.returncode == 0
        assert json.loads(result.stdout)["files"] == []

    def test_missing_path_only_still_exits_1(self):
        result = run_estimate("/this/path/does/not/exist")
        assert result.returncode == 1
        assert "Path not found" in result.stderr


class TestEstimateFileEdgeCases:
    """Unit-level checks on estimate_file/estimate_paths/collect_files (C2, C3)."""

    def test_missing_path_returns_unreadable_entry_not_exception(self, tmp_path):
        vanished = str(tmp_path / "vanished.txt")
        entry = ca.estimate_file(vanished)
        assert entry["advice"] == "unreadable"
        assert entry["tokens"] == 0
        assert entry["bytes"] is None
        assert "error" in entry

    def test_oversized_file_is_sized_without_decoding(self, tmp_path, monkeypatch):
        f = tmp_path / "huge.txt"
        f.write_text("word " * 100, encoding="utf-8")
        monkeypatch.setattr(ca, "MAX_FILE_SIZE_MB", 0)  # force the size-cap branch
        entry = ca.estimate_file(str(f))
        assert entry["advice"] == "search-first"
        assert entry["lines"] is None
        assert entry["tokens"] == entry["bytes"] // 4

    def test_one_unreadable_path_does_not_lose_other_results(self, tmp_path, monkeypatch):
        """A single bad path must not abort the whole `estimate` run (the C2 crash)."""
        good = tmp_path / "good.txt"
        good.write_text("hello\n", encoding="utf-8")
        missing = str(tmp_path / "missing.txt")
        monkeypatch.setattr(ca, "collect_files", lambda paths: ([str(good), missing], []))
        result = ca.estimate_paths([str(tmp_path)])
        assert len(result["files"]) == 2
        advice_by_name = {Path(e["path"]).name: e["advice"] for e in result["files"]}
        assert advice_by_name[good.name] == "read-whole"
        assert advice_by_name["missing.txt"] == "unreadable"

    def test_max_files_cap_truncates_and_reports(self, tmp_path, monkeypatch):
        monkeypatch.setattr(ca, "ESTIMATE_MAX_FILES", 2)
        for i in range(5):
            (tmp_path / f"f{i}.txt").write_text("x\n", encoding="utf-8")
        files, errors = ca.collect_files([str(tmp_path)])
        assert len(files) == 2
        assert any("Stopped after 2 files" in e for e in errors)

#!/usr/bin/env python3
"""Safe Tibo adapter for Eva's local evaluation loop.

Eva remains the evaluator. Validate mode is the default and only validates Eva's
real dataset/configuration. Running conversations is opt-in and requires both
``--mode run`` and ``--approve-run`` plus an explicit run ID.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

SUPPORTED_DOMAINS = ("airline", "itsm", "medical_hr", "automotive")
SUPPORTED_MODES = ("validate", "run")


@dataclass(frozen=True)
class EvalRequest:
    eva_root: Path
    domain: str = "airline"
    record_ids: tuple[str, ...] = ()
    mode: str = "validate"
    approve_run: bool = False
    run_id: str | None = None
    output_dir: Path = Path("output")

    def validate(self) -> None:
        if self.mode not in SUPPORTED_MODES:
            raise ValueError(f"unsupported Eva mode: {self.mode}")
        if self.domain not in SUPPORTED_DOMAINS:
            raise ValueError(f"unsupported Eva domain: {self.domain}")
        if self.mode == "run":
            if not self.approve_run:
                raise ValueError("--approve-run is required for Eva run mode")
            if not self.run_id:
                raise ValueError("--run-id is required for Eva run mode")
        if not (self.eva_root / "src" / "eva" / "cli.py").is_file():
            raise ValueError("Eva checkout not found")
        if not self.dataset_path.is_file():
            raise ValueError(f"Eva dataset not found for domain: {self.domain}")

    @property
    def dataset_path(self) -> Path:
        return self.eva_root / "data" / f"{self.domain}_dataset.json"

    @property
    def run_dir(self) -> Path | None:
        if self.mode != "run" or self.run_id is None:
            return None
        output_dir = self.output_dir if self.output_dir.is_absolute() else self.eva_root / self.output_dir
        return output_dir / self.run_id


@dataclass(frozen=True)
class EvalResult:
    mode: str
    status: str
    exit_code: int
    domain: str
    record_ids: tuple[str, ...]
    eva_root: Path
    dataset_path: Path
    run_id: str | None = None
    run_dir: Path | None = None
    error: str | None = None


def build_command(request: EvalRequest, python: Path) -> list[str]:
    """Return the only Eva command Tibo is allowed to launch for this mode."""
    _ = request
    command = [str(python), "-m", "eva.cli"]
    if request.mode == "validate":
        command.append("--dry-run")
    return command


def build_environment(request: EvalRequest) -> dict[str, str]:
    """Build an environment with no inherited secrets for validate mode.

    Run mode intentionally omits dotenv disabling so Eva can load its own `.env`,
    but only after the request has passed the explicit approval checks.
    """
    path = os.environ.get("PATH", "")
    if Path("/opt/homebrew/bin").is_dir() and "/opt/homebrew/bin" not in path.split(os.pathsep):
        path = os.pathsep.join(filter(None, (path, "/opt/homebrew/bin")))
    environment = {"PATH": path, "PYTHONPATH": str(request.eva_root / "src")}
    if request.mode == "run":
        environment.update(
            {
                "EVA_DOMAIN": request.domain,
                "EVA_OUTPUT_DIR": str(request.output_dir),
                "EVA_RUN_ID": request.run_id or "",
            }
        )
        if request.record_ids:
            environment["EVA_RECORD_IDS"] = ",".join(request.record_ids)
        return environment

    environment.update(
        {
            "EVA_DRY_RUN": "true",
            "EVA_PREFLIGHT": "false",
            # Eva's dotenv loader is disabled so a local checkout's secrets never enter this child.
            "PYTHON_DOTENV_DISABLED": "true",
            # LiteLLM imports eagerly and otherwise fetches its cost map over the network.
            "LITELLM_LOCAL_MODEL_COST_MAP": "true",
            # Eva skips pipeline/service validation at zero attempts; no provider is contacted.
            "EVA_MAX_RERUN_ATTEMPTS": "0",
            "EVA_RUN_ID": "tibo-dry-run",
            "EVA_DOMAIN": request.domain,
            "EVA_MODEL_LIST": json.dumps(
                [
                    {
                        "model_name": "tibo-dry-run",
                        "litellm_params": {"model": "openai/tibo-dry-run", "api_key": "dry-run"},
                    }
                ]
            ),
        }
    )
    if request.record_ids:
        environment["EVA_RECORD_IDS"] = ",".join(request.record_ids)
    return environment


def _python_for(request: EvalRequest) -> Path:
    configured = os.environ.get("TIBO_EVA_PYTHON")
    if configured:
        return Path(configured)
    virtualenv_python = request.eva_root / ".venv" / "bin" / "python"
    return virtualenv_python if virtualenv_python.is_file() else Path(sys.executable)


def _failure(request: EvalRequest, error: str) -> EvalResult:
    return EvalResult(
        mode=request.mode,
        status="failed",
        exit_code=2,
        domain=request.domain,
        record_ids=request.record_ids,
        eva_root=request.eva_root,
        dataset_path=request.dataset_path,
        run_id=request.run_id,
        run_dir=request.run_dir,
        error=error,
    )


def run_eval(request: EvalRequest) -> EvalResult:
    """Run Eva's CLI, isolating validate mode and suppressing run output."""
    try:
        request.validate()
    except ValueError as error:
        return _failure(request, str(error))

    python = _python_for(request)
    if not python.is_file():
        return _failure(request, f"Eva Python not found: {python}")

    try:
        if request.mode == "validate":
            with tempfile.TemporaryDirectory(prefix="tibo-eva-") as temporary:
                cwd = Path(temporary)
                # Eva's dataset_path is relative to cwd. The symlink exposes only its real
                # local dataset while keeping cwd away from Eva's .env and local secrets.
                (cwd / "data").symlink_to(request.eva_root / "data", target_is_directory=True)
                completed = subprocess.run(
                    build_command(request, python),
                    cwd=cwd,
                    env=build_environment(request),
                    capture_output=True,
                    text=True,
                    check=False,
                )
        else:
            # Approved runs use Eva's own cwd/.env and Eva-owned output/retry behavior.
            completed = subprocess.run(
                build_command(request, python),
                cwd=request.eva_root,
                env=build_environment(request),
                capture_output=True,
                text=True,
                check=False,
            )
    except OSError as error:
        return _failure(request, f"could not launch Eva: {error}")

    if request.mode == "validate":
        if completed.stdout:
            print(completed.stdout, end="")
        if completed.stderr:
            print(completed.stderr, end="", file=sys.stderr)
    return EvalResult(
        mode=request.mode,
        status="passed" if completed.returncode == 0 else "failed",
        exit_code=completed.returncode,
        domain=request.domain,
        record_ids=request.record_ids,
        eva_root=request.eva_root,
        dataset_path=request.dataset_path,
        run_id=request.run_id,
        run_dir=request.run_dir,
        error=None if completed.returncode == 0 else f"Eva {request.mode} failed",
    )


def _marker_payload(request: EvalRequest, *, status: str, exit_code: int | None) -> dict:
    return {
        "dataset_path": str(request.dataset_path),
        "domain": request.domain,
        "eva_root": str(request.eva_root),
        "exit_code": exit_code,
        "mode": request.mode,
        "record_ids": list(request.record_ids),
        "run_dir": str(request.run_dir) if request.run_dir else None,
        "run_id": request.run_id,
        "status": status,
    }


def start_marker(request: EvalRequest) -> str:
    return json.dumps(_marker_payload(request, status="started", exit_code=None), ensure_ascii=False, sort_keys=True)


def result_marker(result: EvalResult) -> str:
    payload = {
        "dataset_path": str(result.dataset_path),
        "domain": result.domain,
        "eva_root": str(result.eva_root),
        "exit_code": result.exit_code,
        "mode": result.mode,
        "record_ids": list(result.record_ids),
        "run_dir": str(result.run_dir) if result.run_dir else None,
        "run_id": result.run_id,
        "status": result.status,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Eva's local evaluation loop through Tibo.")
    parser.add_argument(
        "--eva-root",
        type=Path,
        default=Path(os.environ.get("TIBO_EVA_ROOT", Path.home() / "eva")),
        help="Eva checkout (default: TIBO_EVA_ROOT or ~/eva)",
    )
    parser.add_argument("--domain", choices=SUPPORTED_DOMAINS, default="airline")
    parser.add_argument("--record-id", action="append", default=[], help="Record ID (repeatable)")
    parser.add_argument("--mode", choices=SUPPORTED_MODES, default="validate")
    parser.add_argument("--approve-run", action="store_true", help="Explicitly approve a provider/network Eva run")
    parser.add_argument("--run-id", help="Explicit Eva run ID (required with --mode run)")
    parser.add_argument("--output-dir", type=Path, default=Path("output"), help="Eva output base directory")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    request = EvalRequest(
        eva_root=args.eva_root.expanduser().resolve(),
        domain=args.domain,
        record_ids=tuple(args.record_id),
        mode=args.mode,
        approve_run=args.approve_run,
        run_id=args.run_id,
        output_dir=args.output_dir,
    )
    print(f"TIBO_EVAL_START {start_marker(request)}", flush=True)
    result = run_eval(request)
    print(f"TIBO_EVAL {result_marker(result)}", flush=True)
    if result.error:
        print(f"TIBO_EVAL_ERROR {result.error}", file=sys.stderr, flush=True)
    return result.exit_code


if __name__ == "__main__":
    raise SystemExit(main())

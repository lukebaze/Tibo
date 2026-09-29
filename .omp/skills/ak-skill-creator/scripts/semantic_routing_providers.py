"""The shared ak CLI is the only live provider boundary; replay never starts it."""
import subprocess
import tempfile
import threading
from semantic_routing_contract import decode, encoded, unwrap


class DecisionCLIProvider:
    def __init__(self, executable="ak", live=False):
        self.executable, self.live = executable, live

    def call(self, payload, validate=False):
        if not validate and not self.live:
            raise ValueError("explicit --live consent required")
        raw = encoded(payload)
        if len(raw) > 32768:
            raise ValueError("cli_envelope_limit")
        argv = [self.executable, "eval", "decision", "-", "--json"]
        if validate:
            argv.append("--validate-only")
        chunks = []
        with tempfile.TemporaryFile() as source:
            source.write(raw)
            source.seek(0)
            process = subprocess.Popen(argv, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            def bounded_output():
                value = process.stdout.read((1 << 20) + 1)
                chunks.append(value)
                if len(value) > 1 << 20:
                    process.kill()
            reader = threading.Thread(target=bounded_output, daemon=True)
            reader.start()
            try:
                process.wait(timeout=35)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise ValueError("decision_cli_timeout") from None
            finally:
                reader.join(timeout=5)
                if not reader.is_alive():
                    process.stdout.close()
            if reader.is_alive() or not chunks or len(chunks[0]) > 1 << 20:
                raise ValueError("decision_cli_output_limit")
        try:
            result = decode(chunks[0])
        except (ValueError, UnicodeError):
            raise ValueError("decision_cli_invalid_json") from None
        if validate and unwrap(result).get("status") != "validated":
            raise ValueError(unwrap(result).get("fallback_reason", "request_invalid"))
        return result


class ReplayProvider:
    def __init__(self, records):
        self.records = iter(records)

    def response(self, binding):
        try:
            record = next(self.records)
        except StopIteration:
            raise ValueError("missing_replay_batch") from None
        if not isinstance(record, dict):
            raise ValueError("invalid replay record")
        if record.get("binding") != binding:
            raise ValueError("stale_duplicate_or_mismatched_replay")
        return record["envelope"]

    def finish(self):
        if next(self.records, None) is not None:
            raise ValueError("unexpected_replay_batch")


def replay_records(path):
    # JSONL permits 10,000 cases without buffering all raw provider responses.
    with open(path, "rb") as stream:
        while True:
            line = stream.readline((1 << 20) + 1)
            if not line:
                break
            if len(line) > 1 << 20:
                raise ValueError("replay_record_limit")
            if line.strip():
                yield decode(line)

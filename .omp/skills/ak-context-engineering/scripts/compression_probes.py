"""Reviewable probe candidates and explicitly lexical diagnostics (no judge)."""

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Optional


class ProbeType(Enum):
    RECALL = "recall"
    ARTIFACT = "artifact"
    CONTINUATION = "continuation"
    DECISION = "decision"
    CONSTRAINT = "constraint"


@dataclass
class Probe:
    type: ProbeType
    question: str
    ground_truth: str
    context_reference: Optional[str] = None
    id: str = ""
    critical: bool = False
    reviewed: bool = False


def probe_record(probe):
    record = asdict(probe)
    record["type"] = probe.type.value
    return record


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_messages(data):
    messages = data.get("messages") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        raise ValueError("Original context must be a list or an object with messages")
    for message in messages:
        if not isinstance(message, (str, dict)):
            raise ValueError("Messages must contain strings or objects with text content")
        if isinstance(message, dict) and not isinstance(message.get("content"), str):
            raise ValueError("Message content must be text")
    canonical_json(messages)  # Reject non-finite metadata before producing hashes.
    return messages


def message_text(messages):
    return "\n".join(m["content"] if isinstance(m, dict) else m for m in messages)


def binding(messages, summary, probes):
    return {"source_sha256": digest(canonical_json(messages)),
            "summary_sha256": digest(summary),
            "probes_sha256": digest(canonical_json([probe_record(p) for p in probes]))}


def generate_probes(messages):
    """Extract exact source lines as candidates; review still establishes the rubric."""
    messages = validate_messages(messages)
    probes = []
    patterns = [
        (ProbeType.CONSTRAINT, r"\b(must|never|do not|don't|keep|required)\b",
         "Which constraint must remain true?"),
        (ProbeType.CONTINUATION, r"\b(next steps?|todo|pending)\b",
         "What work should continue next?"),
        (ProbeType.ARTIFACT, r"[\w/.-]+\.[A-Za-z][A-Za-z0-9]*\b",
         "What artifact and its state are recorded?"),
        (ProbeType.DECISION, r"\b(decided|chose|went with)\b",
         "What decision and rationale are recorded?"),
        (ProbeType.RECALL, r"\b(error|implemented|found that)\b",
         "What observation is recorded?"),
    ]
    for line in message_text(messages).splitlines():
        line = line.strip()
        if not line:
            continue
        for kind, pattern, question in patterns:
            if re.search(pattern, line, re.IGNORECASE):
                probes.append(Probe(kind, question, line, line,
                                    f"probe-{len(probes) + 1}",
                                    kind == ProbeType.CONSTRAINT))
    return probes


def load_probes(data, messages):
    if not isinstance(data, list):
        raise ValueError("Probes must be a JSON list")
    probes, ids = [], set()
    for record in data:
        if not isinstance(record, dict):
            raise ValueError("Each probe must be an object")
        if not {"critical", "reviewed"} <= record.keys():
            raise ValueError("Each probe must explicitly declare critical and reviewed")
        try:
            probe = Probe(**{**record, "type": ProbeType(record["type"])})
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid probe: {exc}") from exc
        for name in ("id", "question", "ground_truth", "context_reference"):
            if not isinstance(getattr(probe, name), str) or not getattr(probe, name).strip():
                raise ValueError(f"Probe {name} must be nonempty text")
        if probe.id in ids:
            raise ValueError("Probe IDs must be unique")
        if type(probe.critical) is not bool or type(probe.reviewed) is not bool:
            raise ValueError("Probe critical and reviewed fields must be boolean")
        if probe.context_reference not in message_text(messages):
            raise ValueError(f"Probe {probe.id} context_reference is absent from source")
        ids.add(probe.id)
        probes.append(probe)
    return probes


def evaluate_response(probe, response):
    """Report lexical evidence only, including matches that may reverse meaning."""
    truth = probe.ground_truth.casefold()
    words = set(re.findall(r"\w+", truth))
    response_words = set(re.findall(r"\w+", response.casefold()))
    return {"evidence_type": "lexical_only", "semantic_score": None,
            "exact_text_present": bool(truth) and truth in response.casefold(),
            "word_overlap_fraction": len(words & response_words) / len(words) if words else None,
            "limitation": "Text overlap cannot establish correctness, negation, or task continuity."}

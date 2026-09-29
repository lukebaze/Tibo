"""Capacity diagnostics; lexical matches cannot measure model attention or quality."""
import json
import os
import re

from context_budget import capacity


def estimate_tokens(text):
    """Rough English-oriented estimate; not calibrated for code or other languages."""
    return len(text) // 4


def load_messages(path, max_mb=100):
    if os.path.getsize(path) > max_mb * 1024 * 1024:
        raise ValueError(f"File too large. Max {max_mb}MB")
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON: {error.msg}") from error
    messages = data.get("messages") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        raise ValueError("Expected messages array")
    return messages


def analyze_context(messages, token_limit=None, critical_keywords=None, *, used_tokens=None,
                    next_step=0, output_reserve=0, checkpoint_reserve=0):
    if not isinstance(messages, list):
        raise ValueError("Expected messages array")
    content = [str(message.get("content", "") if isinstance(message, dict) else message)
               for message in messages]
    estimated = sum(estimate_tokens(text) + 10 for text in content)
    used = estimated if used_tokens is None else used_tokens
    report = capacity(used, token_limit, next_step, output_reserve, checkpoint_reserve)
    keywords = critical_keywords or ["goal", "task", "important", "critical", "must"]
    signals = []
    for index, text in enumerate(content):
        matches = sorted(set(re.findall(r"\b(?:error|failed|exception|invalid|undefined|null)\b", text.lower())))
        critical = [word for word in keywords if word.lower() in text.lower()]
        if matches or critical:
            signals.append({"message_index": index, "error_words": matches, "critical_keywords": critical})
    return {"schema_version": 2, "total_tokens": used, "estimated_message_tokens": estimated,
            "token_limit": token_limit, "utilization": report["utilization"],
            "measurement": "estimated-characters-divided-by-four" if used_tokens is None else "runtime-reported-by-caller",
            "estimate_scope": "supplied message content and approximate overhead; excludes omitted system/tools/media",
            "capacity": report, "health_status": "unknown", "health_score": None,
            "degradation_risk": None, "poisoning_risk": None,
            "lexical_signals": signals,
            "recommendations": ["Capacity bands are advisory, not measurements of reasoning quality.",
                "Lexical matches may describe fixed errors; verify a concrete failure before recovery.",
                "Without a verified window, do not infer utilization from file sizes or tool-call counts."]}

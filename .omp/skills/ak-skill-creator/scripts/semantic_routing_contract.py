"""Local routing contracts; expected labels never enter shared decision requests."""
import hashlib
import json

PROTOCOL = "skill-routing-v1"
MAX_CASES = 10000


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def fingerprint(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def decode(raw):
    def invalid(_):
        raise ValueError("nonfinite JSON number")
    return json.loads(raw, object_pairs_hook=strict_object, parse_constant=invalid)


def load(path, limit=64 << 20):
    with open(path, "rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("input exceeds byte limit")
    return decode(raw)


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise ValueError("missing or unknown contract fields")


def text(value, limit):
    return isinstance(value, str) and bool(value.strip()) and len(value.encode()) <= limit


def validate_catalog(catalog):
    fields(catalog, ("schema_version", "runtime", "scope", "provenance", "skills"))
    fields(catalog["runtime"], ("name", "version", "settings"))
    if catalog["schema_version"] != 1 or not all(text(catalog["runtime"][k], 128) for k in ("name", "version")):
        raise ValueError("invalid runtime identity")
    if not isinstance(catalog["runtime"]["settings"], dict) or not text(catalog["scope"], 256):
        raise ValueError("invalid runtime settings/scope")
    fields(catalog["provenance"], ("kind", "source", "complete"))
    if not isinstance(catalog["skills"], list) or not 2 <= len(catalog["skills"]) <= 127:
        raise ValueError("routing_criteria_limit: 2..127 skills plus none")
    ids = set()
    for skill in catalog["skills"]:
        fields(skill, ("id", "description"), ("when_to_use", "keywords", "path"))
        if not text(skill["id"], 256) or skill["id"] == "none" or skill["id"] in ids or not text(skill["description"], 2048):
            raise ValueError("invalid/duplicate catalog identity or metadata")
        if not isinstance(skill.get("when_to_use", ""), str) or len(skill.get("when_to_use", "").encode()) > 2048:
            raise ValueError("routing metadata exceeds bound")
        if "path" in skill and not text(skill["path"], 4096):
            raise ValueError("invalid catalog path")
        words = skill.get("keywords", [])
        if not isinstance(words, list) or len(words) > 32 or not all(text(w, 128) for w in words):
            raise ValueError("invalid keywords")
        ids.add(skill["id"])
    return sorted(ids)


def authoritative(catalog):
    p = catalog["provenance"]
    return p["kind"] == "runtime-visible-export" and p["complete"] is True and text(p["source"], 4096)


def validate_cases(document, catalog):
    roster = validate_catalog(catalog)
    fields(document, ("schema_version", "holdout_id", "cases"))
    if document["schema_version"] != 1 or not text(document["holdout_id"], 128) or not isinstance(document["cases"], list) or not 1 <= len(document["cases"]) <= MAX_CASES:
        raise ValueError("invalid case set")
    seen = set()
    for case in document["cases"]:
        fields(case, ("id", "split", "prompt", "expected", "class"))
        if not text(case["id"], 128) or case["id"] in seen or not text(case["prompt"], 1500) or case["split"] not in ("train", "holdout") or case["expected"] not in roster + ["none"] or case["class"] not in ("positive", "indirect", "near-miss"):
            raise ValueError("invalid case identity, split, prompt or label")
        for skill in roster:
            if (":" in skill and skill in case["prompt"]) or "$" + skill in case["prompt"] or "/" + skill in case["prompt"]:
                raise ValueError("forced skill prompt")
        seen.add(case["id"])
    return sorted(document["cases"], key=lambda c: c["id"])


def request(catalog, batch):
    skills = sorted(catalog["skills"], key=lambda s: s["id"])
    state = {"catalog": [dict(id=f"s{i:03}", name=s["id"], **{k: v for k, v in s.items() if k in ("description", "when_to_use", "keywords")}) for i, s in enumerate(skills)],
             "cases": [{"id": f"c{i:03}", "prompt": c["prompt"]} for i, c in enumerate(batch)]}
    return {"consumer": "skill-routing-eval", "state": state, "legacy": {c["id"]: "none" for c in state["cases"]}}


def batches(cases, size):
    if not isinstance(size, int) or not 1 <= size <= 8:
        raise ValueError("batch size must be 1..8")
    for offset in range(0, len(cases), size):
        yield cases[offset:offset + size]


def batch_binding(catalog, batch):
    return {"case_ids": [c["id"] for c in batch], "request_hash": fingerprint(request(catalog, batch)), "catalog_hash": fingerprint(catalog), "cases_hash": fingerprint(batch)}


def unwrap(envelope):
    if not isinstance(envelope, dict):
        raise ValueError("invalid decision envelope")
    # The shared CLI wraps JSON in {schema_version, kind, data}.
    result = envelope.get("data", envelope)
    if not isinstance(result, dict):
        raise ValueError("invalid decision data")
    return result

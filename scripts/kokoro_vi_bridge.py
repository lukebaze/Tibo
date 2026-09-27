#!/usr/bin/env python3
"""Persistent stdio bridge for the Kokoro Vietnamese ONNX engine.

Protocol: one request per line on stdin, `<hex(utf8 text)>\t<output wav path>`,
answered with `OK` or `ERR <hex(message)>`. Model, voicepack and phonemizer are
loaded once, before `READY` is printed, so the session pays that cost one time.

No torch: the voicepack is a torch.save zip whose `<stem>/data/0` entry is the raw
[max_phonemes, 1, 256] fp32 style tensor, so it is read with the stdlib and numpy.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
import wave
import zipfile
from pathlib import Path

import numpy as np

SAMPLE_RATE = 24000
STYLE_DIM = 256
CONTEXT_LENGTH = 512
# One input id per phoneme plus the two boundary zeros, which is also how many
# style frames the voicepacks carry (510 observed on all of them).
MAX_PHONEMES = CONTEXT_LENGTH - 2
DEFAULT_MODEL_DIR = "~/.local/share/tibo/models/kokoro-vi"
DEFAULT_VOICE = "ngoc_huyen"
DEFAULT_CROSSFADE_MS = 50


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", action="store_true")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--model-dir", default=DEFAULT_MODEL_DIR)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--crossfade-ms", type=int, default=DEFAULT_CROSSFADE_MS)
    args = parser.parse_args()
    if not args.server:
        raise SystemExit("--server is required")
    if args.threads < 0:
        raise SystemExit("threads must be non-negative")
    if args.speed <= 0:
        raise SystemExit("speed must be greater than 0")
    return args


def load_voicepack(path: Path) -> np.ndarray:
    """Read the raw style tensor out of a torch.save zip without importing torch."""
    with zipfile.ZipFile(path) as archive:
        stems = {name.split("/", 1)[0] for name in archive.namelist() if "/" in name}
        if len(stems) != 1:
            raise ValueError(f"unexpected voicepack layout ({len(stems)} roots) in {path.name}")
        stem = stems.pop()
        raw = archive.read(f"{stem}/data/0")
        byte_order = archive.read(f"{stem}/byteorder").decode("ascii", "replace").strip()
    if byte_order not in ("little", ""):
        raise ValueError(f"unsupported voicepack byte order {byte_order!r} in {path.name}")
    if len(raw) % (4 * STYLE_DIM) != 0:
        raise ValueError(
            f"voicepack payload {len(raw)} bytes is not a multiple of {4 * STYLE_DIM} in {path.name}"
        )
    styles = np.frombuffer(raw, dtype="<f4").reshape(-1, 1, STYLE_DIM)
    if styles.shape[0] < MAX_PHONEMES:
        raise ValueError(
            f"voicepack {path.name} holds {styles.shape[0]} frames, expected at least {MAX_PHONEMES}"
        )
    return styles


def split_text(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text.strip())
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    for match in re.finditer(r"[.!?…]+(?:[\"”’)]*)", normalized):
        end = match.end()
        if end < len(normalized) and not normalized[end].isspace():
            continue
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    remainder = normalized[start:].strip()
    if remainder:
        chunks.append(remainder)
    return chunks


def phonemes_to_input_ids(phonemes: str, vocab: dict[str, int]) -> np.ndarray:
    input_ids = [vocab[phoneme] for phoneme in phonemes if phoneme in vocab]
    if not input_ids:
        raise ValueError("no known phonemes in chunk")
    if len(input_ids) + 2 > CONTEXT_LENGTH:
        raise ValueError(f"phoneme sequence too long: {len(input_ids) + 2} > {CONTEXT_LENGTH}")
    return np.asarray([[0, *input_ids, 0]], dtype=np.int64)


def select_voice_style(voicepack: np.ndarray, phoneme_count: int) -> np.ndarray:
    if phoneme_count <= 0:
        raise ValueError("phoneme_count must be positive")
    index = min(phoneme_count, voicepack.shape[0]) - 1
    return np.asarray(voicepack[index], dtype=np.float32)


def merge_audio_chunks(chunks: list[np.ndarray], crossfade_samples: int) -> np.ndarray:
    valid = [np.asarray(chunk, dtype=np.float32).reshape(-1) for chunk in chunks if len(chunk) > 0]
    if not valid:
        return np.empty(0, dtype=np.float32)
    merged = valid[0]
    for chunk in valid[1:]:
        overlap = min(int(crossfade_samples), len(merged), len(chunk))
        if overlap <= 0:
            merged = np.concatenate([merged, chunk])
            continue
        fade_out = np.linspace(1.0, 0.0, overlap + 2, dtype=np.float32)[1:-1]
        fade_in = 1.0 - fade_out
        crossfaded = (merged[-overlap:] * fade_out) + (chunk[:overlap] * fade_in)
        merged = np.concatenate([merged[:-overlap], crossfaded, chunk[overlap:]])
    return merged.astype(np.float32, copy=False)


class KokoroEngine:
    def __init__(self, args: argparse.Namespace) -> None:
        import onnxruntime as ort

        self.speed = float(args.speed)
        self.crossfade_samples = round(SAMPLE_RATE * int(args.crossfade_ms) / 1000)
        model_dir = Path(args.model_dir).expanduser()
        config_path = model_dir / "config.json"
        onnx_path = model_dir / "kokoro_vi.onnx"
        voicepack_path = model_dir / "voicepacks" / f"{args.voice}.pt"
        for path in (config_path, onnx_path, voicepack_path):
            if not path.is_file():
                raise FileNotFoundError(f"missing Kokoro Vietnamese asset: {path}")

        with config_path.open(encoding="utf-8") as handle:
            config = json.load(handle)
        self.vocab: dict[str, int] = config["vocab"]
        self.voicepack = load_voicepack(voicepack_path)

        options = ort.SessionOptions()
        if args.threads > 0:
            options.intra_op_num_threads = args.threads
        options.log_severity_level = 3
        self.session = ort.InferenceSession(
            str(onnx_path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.input_names = {entry.name for entry in self.session.get_inputs()}
        missing = {"input_ids", "ref_s"} - self.input_names
        if missing:
            raise ValueError(f"ONNX model is missing inputs {sorted(missing)}")

        from vig2p import phonemize_text

        self.phonemize = phonemize_text

    def synthesize(self, text: str, output: Path) -> None:
        if not text.strip():
            raise ValueError("text must not be empty")
        audio_chunks: list[np.ndarray] = []
        for chunk in split_text(text):
            phonemes = self.phonemize(chunk)
            if not phonemes:
                continue
            inputs = {
                "input_ids": phonemes_to_input_ids(phonemes, self.vocab),
                "ref_s": select_voice_style(self.voicepack, len(phonemes)),
            }
            if "speed" in self.input_names:
                inputs["speed"] = np.asarray(self.speed, dtype=np.float32)
            waveform = self.session.run(None, inputs)[0]
            audio_chunks.append(np.asarray(waveform, dtype=np.float32).reshape(-1))
        audio = merge_audio_chunks(audio_chunks, self.crossfade_samples)
        if len(audio) == 0:
            raise RuntimeError("Kokoro returned no audio")
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
        with wave.open(str(output), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm.tobytes())


def serve(args: argparse.Namespace) -> None:
    with contextlib.redirect_stdout(sys.stderr):
        engine = KokoroEngine(args)
    print("READY", flush=True)
    for request in sys.stdin:
        output: Path | None = None
        try:
            encoded_text, encoded_output = request.rstrip("\n").split("\t", 1)
            text = bytes.fromhex(encoded_text).decode("utf-8")
            output = Path(encoded_output)
            engine.synthesize(text, output)
            print("OK", flush=True)
        except Exception as error:
            if output is not None:
                output.unlink(missing_ok=True)
            encoded_error = (error.__class__.__name__ + ": " + str(error)).encode().hex()
            print(f"ERR {encoded_error}", flush=True)


if __name__ == "__main__":
    serve(parse_args())

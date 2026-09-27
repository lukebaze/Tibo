#!/usr/bin/env python3
import argparse
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError("WAV must be mono 16-bit PCM")
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
        return samples.astype(np.float32) / 32768.0, wav.getframerate()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()

    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(args.model_dir / "encoder.int8.onnx"),
        decoder=str(args.model_dir / "decoder.int8.onnx"),
        joiner=str(args.model_dir / "joiner.int8.onnx"),
        tokens=str(args.model_dir / "tokens.txt"),
        num_threads=args.threads,
        hotwords_file=str(args.model_dir / "hotwords.txt"),
        hotwords_score=3.0,
        modeling_unit="bpe",
        bpe_vocab=str(args.model_dir / "bpe.vocab"),
        sample_rate=16000,
        feature_dim=80,
        decoding_method="modified_beam_search",
    )
    samples, sample_rate = read_wav(args.wav)
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, samples)
    recognizer.decode_stream(stream)
    print(stream.result.text.strip())


if __name__ == "__main__":
    main()

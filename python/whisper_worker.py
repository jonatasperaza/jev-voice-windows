"""
Worker de reconhecimento de voz local, via faster-whisper (CTranslate2),
rodando na GPU (CUDA) com fallback pra CPU. Fica vivo o processo inteiro
(o modelo e carregado uma unica vez) e conversa com o Electron por
stdin/stdout em linhas JSON:

  Electron -> worker: {"cmd": "listen", "language": "pt",
                        "maxListenSeconds": 12,
                        "initialSilenceSeconds": 6,
                        "endSilenceSeconds": 1.2}
  worker -> Electron: {"ready": true}                (uma vez, no boot)
                       {"text": "..."}                (apos cada listen)
                       {"error": "..."}                (se algo falhar)

Captura de audio e endpointing (deteccao de inicio/fim de fala) sao
feitos manualmente aqui via RMS simples, pra nao depender de nenhum
servico do Windows.
"""

import sys
import os
import glob
import json
from collections import deque
import numpy as np
import sounddevice as sd


def _add_nvidia_dll_dirs():
    """
    No Windows, os wheels da NVIDIA (nvidia-cublas-cu12, nvidia-cudnn-cu12)
    instalam as DLLs dentro do site-packages em vez do PATH do sistema, e
    o ctranslate2 nao acha sozinho. Sem isso o CUDA falha com erro tipo
    "Library cublas64_12.dll is not found or cannot be loaded" mesmo com
    a GPU corretamente detectada.
    """
    site_packages = os.path.dirname(os.path.dirname(np.__file__))
    for bin_dir in glob.glob(os.path.join(site_packages, "nvidia", "*", "bin")):
        os.add_dll_directory(bin_dir)
        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


if sys.platform == "win32":
    _add_nvidia_dll_dirs()

from faster_whisper import WhisperModel

MODEL_SIZE = "large-v3-turbo"
SAMPLE_RATE = 16000
BLOCK_MS = 30
BLOCK_SIZE = int(SAMPLE_RATE * BLOCK_MS / 1000)
SILENCE_RMS_THRESHOLD = 0.012


def log(msg):
    print(json.dumps({"log": str(msg)}), file=sys.stderr, flush=True)


def load_model():
    try:
        model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
        log("Modelo carregado na GPU (CUDA).")
        return model
    except Exception as e:
        log(f"GPU indisponivel ({e}), caindo para CPU.")
        model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        log("Modelo carregado na CPU.")
        return model


PRE_ROLL_SECONDS = 0.3
PRE_ROLL_BLOCKS = max(1, int(PRE_ROLL_SECONDS * 1000 / BLOCK_MS))


def record(max_seconds, initial_silence_seconds, end_silence_seconds):
    chunks = []
    # Guarda os ultimos ~300ms antes do volume cruzar o threshold, senao
    # o inicio da palavra (a parte mais fraca/consoante inicial) fica de
    # fora e o Whisper transcreve errado (ex: "Abra" virando "para").
    pre_roll = deque(maxlen=PRE_ROLL_BLOCKS)
    started = False
    silence_since_speech = 0.0
    elapsed = 0.0

    with sd.InputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=BLOCK_SIZE
    ) as stream:
        while elapsed < max_seconds:
            block, _ = stream.read(BLOCK_SIZE)
            block = block[:, 0]
            elapsed += BLOCK_MS / 1000
            rms = float(np.sqrt(np.mean(np.square(block))))

            if rms > SILENCE_RMS_THRESHOLD:
                if not started:
                    started = True
                    chunks.extend(pre_roll)
                silence_since_speech = 0.0
                chunks.append(block.copy())
            elif started:
                silence_since_speech += BLOCK_MS / 1000
                chunks.append(block.copy())
                if silence_since_speech >= end_silence_seconds:
                    break
            else:
                pre_roll.append(block.copy())
                if elapsed >= initial_silence_seconds:
                    break

    if not chunks:
        return None
    return np.concatenate(chunks)


def main():
    log("Carregando modelo Whisper...")
    model = load_model()
    print(json.dumps({"ready": True}), flush=True)
    log("Worker pronto, aguardando comandos.")

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        if req.get("cmd") != "listen":
            continue

        language = req.get("language", "pt")
        max_seconds = float(req.get("maxListenSeconds", 12))
        initial_silence = float(req.get("initialSilenceSeconds", 6))
        end_silence = float(req.get("endSilenceSeconds", 1.2))

        try:
            audio = record(max_seconds, initial_silence, end_silence)
            if audio is None:
                print(json.dumps({"text": ""}), flush=True)
                continue

            segments, _ = model.transcribe(
                audio, language=language, beam_size=1, vad_filter=True
            )
            text = "".join(seg.text for seg in segments).strip()
            print(json.dumps({"text": text}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()

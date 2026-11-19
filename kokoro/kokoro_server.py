import io
import os
import re
import threading
import urllib.request
import wave
from collections import OrderedDict
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel

HERE = Path(__file__).parent
MODELS = HERE / "models"
MODELS.mkdir(exist_ok=True)
PORT = int(os.environ.get("KOKORO_PORT", "8788"))
BASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

PREFERRED = ["af_heart", "af_bella", "am_michael", "am_adam", "bf_emma", "bm_george"]
DEFAULT = {"fr": "ff_siwis", "en": "af_heart"}
MAX_CHARS = 400


def ensure_files():
    for name in FILES:
        path = MODELS / name
        if path.exists() and path.stat().st_size > 1_000_000:
            continue
        print(f"Téléchargement de {name} (une seule fois)...")
        urllib.request.urlretrieve(BASE_URL + name, path)


ensure_files()
print("Chargement de Kokoro...")
kokoro = Kokoro(str(MODELS / FILES[0]), str(MODELS / FILES[1]))
ALL_VOICES = set(kokoro.get_voices())
FR_VOICES = {v for v in ALL_VOICES if v.startswith("ff_")}
EN_VOICES = {v for v in ALL_VOICES if v[:2] in ("af", "am", "bf", "bm")}
print(f"Kokoro prêt : {len(FR_VOICES)} voix française, {len(EN_VOICES)} voix anglaises.")

lock = threading.Lock()
cache = OrderedDict()
app = FastAPI()


class Req(BaseModel):
    text: str
    language: str = "fr"
    voice: str = ""


def pick_voice(language, voice):
    voice = (voice or "").replace("spk:", "").strip()
    allowed = (FR_VOICES | EN_VOICES) if language == "fr" else EN_VOICES
    return voice if voice in allowed else DEFAULT[language]


def lang_code(language, voice):
    if language == "fr":
        return "fr-fr"
    return "en-gb" if voice.startswith("b") else "en-us"


def split_text(text, limit=MAX_CHARS):
    parts = re.split(r"(?<=[.!?;:,])\s+", text.strip())
    out, cur = [], ""
    for p in parts:
        if cur and len(cur) + 1 + len(p) > limit:
            out.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur)
    final = []
    for c in out:
        while len(c) > limit:
            k = c.rfind(" ", 0, limit)
            k = k if k > 40 else limit
            final.append(c[:k])
            c = c[k:].strip()
        if c:
            final.append(c)
    return final


def synth(text, language, voice):
    code = lang_code(language, voice)
    chunks = []
    gap = None
    for piece in split_text(text):
        samples, sr = kokoro.create(piece, voice=voice, speed=1.0, lang=code)
        if gap is None:
            gap = np.zeros(int(sr * 0.08), dtype=np.float32)
        chunks.append(np.asarray(samples, dtype=np.float32))
        chunks.append(gap)
    if not chunks:
        raise ValueError("Texte vide")
    audio = np.concatenate(chunks)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@app.get("/health")
def health():
    return {"ok": True, "engine": "kokoro"}


def label(v):
    name = v.split("_", 1)[1].capitalize()
    sex = "femme" if v[1] == "f" else "homme"
    accent = ", britannique" if v[0] == "b" else ""
    return f"{name} · {sex}{accent}"


def ordered(names):
    first = [v for v in PREFERRED if v in names]
    return first + sorted(n for n in names if n not in first)


EDGE_VOICES = [
    ("fr-FR-RemyMultilingualNeural", "Rémy · homme"),
    ("fr-FR-VivienneMultilingualNeural", "Vivienne · femme"),
    ("fr-FR-HenriNeural", "Henri · homme"),
    ("fr-FR-DeniseNeural", "Denise · femme"),
    ("fr-CA-AntoineNeural", "Antoine · homme, québécois"),
    ("fr-CA-SylvieNeural", "Sylvie · femme, québécoise"),
    ("fr-CA-JeanNeural", "Jean · homme, québécois"),
]


def synth_edge(text, voice):
    import asyncio
    import edge_tts

    async def run():
        out = b""
        async for chunk in edge_tts.Communicate(text, voice).stream():
            if chunk["type"] == "audio":
                out += chunk["data"]
        return out

    return asyncio.run(run())


@app.get("/voices")
def voices():
    items = [{"id": "edge:" + i, "label": "Edge · " + n, "lang": "fr"} for i, n in EDGE_VOICES]
    items += [{"id": v, "label": label(v), "lang": "fr"} for v in ordered(FR_VOICES)]
    items += [{"id": v, "label": label(v), "lang": "en"} for v in ordered(EN_VOICES)]
    return {"voices": items}


@app.post("/tts")
def tts_route(req: Req):
    text = req.text.strip()
    language = "en" if req.language == "en" else "fr"
    if not text:
        return JSONResponse({"error": "Texte vide"}, status_code=400)
    if (req.voice or "").startswith("edge:"):
        try:
            return Response(synth_edge(text, req.voice[5:]), media_type="audio/mpeg")
        except Exception as e:
            return JSONResponse({"error": f"Edge TTS indisponible (Internet ?) : {e}"}, status_code=500)
    voice = pick_voice(language, req.voice)
    key = (language, voice, text)
    if key in cache:
        cache.move_to_end(key)
        return Response(cache[key], media_type="audio/wav")
    try:
        with lock:
            data = synth(text, language, voice)
    except Exception as e:
        return JSONResponse({"error": f"Synthèse impossible : {e}"}, status_code=500)
    cache[key] = data
    if len(cache) > 400:
        cache.popitem(last=False)
    return Response(data, media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
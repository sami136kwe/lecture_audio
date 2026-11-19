/**
 * Lecteur Studio — serveur local
 * Sert l'interface et génère l'audio via XTTS-v2 en local avec Kokoro.
 *
 * Usage :
 *   export XAI_API_KEY="xai-..."
 *   npm start
 * Puis ouvrir http://127.0.0.1:8787
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 8787;
const VOICES = new Set(["leo", "ara", "eve", "rex", "sal"]);
const KOKORO_URL = process.env.KOKORO_URL || "http://127.0.0.1:8788";
const XTTS_URL = process.env.XTTS_URL || "http://127.0.0.1:8789";
const XTTS_FR = ["Damien Black", "Andrew Chipper", "Craig Gutsy", "Viktor Eka", "Claribel Dervla", "Ana Florence", "Gracie Wise", "Daisy Studious"];
const XTTS_FIRST = ["Claribel Dervla", "Damien Black", "Andrew Chipper", "Craig Gutsy"];
const isXtts = (id) => /^(spk|wav):/.test(id || "");
const engineFor = (id) =>
  isXtts(id)
    ? { url: XTTS_URL, name: "XTTS", cmd: "XTTS_PORT=8789 python xtts_server.py" }
    : { url: KOKORO_URL, name: "Kokoro", cmd: "python kokoro_server.py" };
const cache = new Map();

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": headers["Content-Type"] || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function ttsXtts({ text, voiceId, language }) {
  const clean = String(text || "").trim().slice(0, 800);
  const lang = language === "en" ? "en" : "fr";
  if (!clean) return { ok: false, error: "Texte vide" };
  const cacheKey = createHash("sha256").update(`xtts|${lang}|${voiceId}|${clean}`).digest("hex");
  if (cache.has(cacheKey)) return { ok: true, buffer: cache.get(cacheKey), type: String(voiceId).startsWith("edge:") ? "audio/mpeg" : "audio/wav" };
  const eng = engineFor(voiceId);
  let res;
  try {
    res = await fetch(`${eng.url}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, language: lang, voice: voiceId }),
    });
  } catch {
    return { ok: false, error: `Le service ${eng.name} ne répond pas. Lance-le avec : ${eng.cmd}` };
  }
  if (!res.ok) return { ok: false, error: `Service vocal ${res.status}` };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (cache.size > 100) cache.clear();
  cache.set(cacheKey, buffer);
  return { ok: true, buffer, type: String(voiceId).startsWith("edge:") ? "audio/mpeg" : "audio/wav" };
}

async function tts({ text, voiceId, language }) {
  if (voiceId && !VOICES.has(voiceId)) return ttsXtts({ text, voiceId, language });
  const key = process.env.XAI_API_KEY;
  if (!key) {
    return { ok: false, error: "Ajoute ta clé : export XAI_API_KEY=\"xai-...\"" };
  }
  const clean = String(text || "").trim().slice(0, 800);
  const voice = VOICES.has(voiceId) ? voiceId : "leo";
  const lang = language === "en" ? "en" : "fr";
  if (!clean) return { ok: false, error: "Texte vide" };

  const cacheKey = createHash("sha256").update(`${lang}|${voice}|${clean}`).digest("hex");
  if (cache.has(cacheKey)) return { ok: true, buffer: cache.get(cacheKey) };

  const res = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: clean, voice_id: voice, language: lang }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (/credit|subscription|spending-limit/i.test(detail)) {
      return {
        ok: false,
        error: "Crédits xAI insuffisants. Ajoute des crédits sur grok.com ou utilise la voix navigateur.",
      };
    }
    return { ok: false, error: `API TTS ${res.status}` };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (cache.size > 100) cache.clear();
  cache.set(cacheKey, buffer);
  return { ok: true, buffer };
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".mp3")) return "audio/mpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/tts") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}");
      const result = await tts({
        text: body.text,
        voiceId: body.voiceId || body.voice,
        language: body.language,
      });
      if (!result.ok) return send(res, 502, { ok: false, error: result.error });
      res.writeHead(200, {
        "Content-Type": result.type || "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": result.buffer.length,
      });
      res.end(result.buffer);
    } catch (e) {
      send(res, 500, { ok: false, error: String(e.message || e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/voices") {
    let voices = [];
    try {
      const r = await fetch(`${KOKORO_URL}/voices`);
      if (r.ok) voices = (await r.json()).voices || [];
    } catch {}
    try {
      const r = await fetch(`${XTTS_URL}/voices`);
      if (r.ok) {
        const list = ((await r.json()).voices || []).filter((v) => isXtts(v.id));
        const rank = (v) => {
          const i = XTTS_FIRST.findIndex((n) => v.id === `spk:${n}`);
          return v.id.startsWith("wav:") ? -1 : i < 0 ? 99 : i;
        };
        list.sort((a, b) => rank(a) - rank(b));
        for (const v of list) voices.push({ id: v.id, label: `XTTS · ${v.label}`, lang: "en" });
        const wavs = list.filter((v) => v.id.startsWith("wav:"));
        const frList = XTTS_FR.map((n) => list.find((v) => v.id === `spk:${n}`)).filter(Boolean);
        for (const v of [...wavs, ...frList]) voices.push({ id: v.id, label: `XTTS · ${v.label}`, lang: "fr" });
      }
    } catch {}
    if (process.env.XAI_API_KEY) {
      voices.push({ id: "leo", label: "Leo (xAI)" }, { id: "ara", label: "Ara (xAI)" });
    }
    send(res, 200, { ok: true, voices });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, {
      ok: true,
      hasKey: Boolean(process.env.XAI_API_KEY),
      kokoro: KOKORO_URL,
      xtts: XTTS_URL,
      voices: ["leo", "ara"],
    });
    return;
  }

  let filePath = url.pathname === "/" ? "/lecteur.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(PUBLIC, filePath);
  if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    send(res, 404, { ok: false, error: "Not found" });
    return;
  }
  const data = fs.readFileSync(abs);
  res.writeHead(200, { "Content-Type": contentType(abs) });
  res.end(data);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Lecteur Studio → http://127.0.0.1:${PORT}`);
  console.log(
    process.env.XAI_API_KEY
      ? "Clé XAI_API_KEY détectée — voix Leo / Ara actives en plus de XTTS."
      : `Kokoro via ${KOKORO_URL}, XTTS (optionnel) via ${XTTS_URL}. Sans service, bascule sur la voix navigateur.`,
  );
});

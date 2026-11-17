const ALLOWED_ORIGIN = "https://shanpalia.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...extraHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function validMediaUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error("Please enter a valid media URL."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (u.username || u.password) throw new Error("URLs containing login credentials are not supported.");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "metadata.google.internal" || host === "169.254.169.254" ||
      /^(127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|0\\.)/.test(host) ||
      host === "::1" || host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) {
    throw new Error("This host is not allowed.");
  }
  return u;
}

async function fetchMedia(request, headers) {
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get("url");
  if (!raw || raw.length > 4096) return json({ error: "Paste a valid direct media URL." }, 400, headers);
  try {
    let target = validMediaUrl(raw);
    let upstream;
    for (let i = 0; i < 4; i++) {
      upstream = await fetch(target.toString(), { redirect: "manual", headers: { "User-Agent": "MediaStudio/1.0" } });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const location = upstream.headers.get("Location");
        if (!location) throw new Error("The media host returned an invalid redirect.");
        target = validMediaUrl(new URL(location, target).toString());
        continue;
      }
      break;
    }
    if (!upstream || [301, 302, 303, 307, 308].includes(upstream.status)) throw new Error("Too many redirects from the media host.");
    if (!upstream.ok) throw new Error("Media host returned HTTP " + upstream.status + ".");
    const type = (upstream.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!(type.startsWith("audio/") || type.startsWith("video/") || type === "application/octet-stream")) {
      throw new Error("This URL does not point to a direct audio/video file. Paste a direct .mp3, .mp4, .wav, .m4a or similar file URL.");
    }
    const length = Number(upstream.headers.get("Content-Length") || 0);
    if (length > 25 * 1024 * 1024) throw new Error("Media file is larger than 25 MB. Please use a smaller file.");
    if (!upstream.body) throw new Error("The media host returned an empty file.");
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("Media file is larger than 25 MB. Please use a smaller file.");
    const ext = target.pathname.split("/").pop()?.split(".").pop()?.toLowerCase() || "media";
    return new Response(bytes, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": type === "application/octet-stream" ? "application/octet-stream" : type,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": 'attachment; filename="media.' + ext.replace(/[^a-z0-9]/g, "").slice(0, 8) + '"',
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return json({ error: error?.message || "Could not fetch this media URL." }, 400, headers);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Media Studio Speech-to-Text", configured: Boolean(env.GROQ_API_KEY) }, 200, headers);
    }
    if (url.pathname === "/api/fetch-media" && request.method === "GET") return fetchMedia(request, headers);

    if (url.pathname === "/api/translate" && request.method === "POST") {
      if (!env.GROQ_API_KEY) return json({ error: "Groq API key is not configured." }, 503, headers);
      try {
        const body = await request.json();
        const text = String(body.text || "").trim();
        const targetLanguage = String(body.targetLanguage || "").trim();
        const sourceLanguage = String(body.sourceLanguage || "auto-detected").trim();
        const allowedLanguages = ["Hindi", "English", "Urdu", "Arabic", "Bengali", "Punjabi", "Tamil", "Telugu", "Marathi", "Gujarati", "Spanish", "French"];
        if (!text) return json({ error: "Please provide lyrics to translate." }, 400, headers);
        if (text.length > 12000) return json({ error: "Lyrics are too long. Please translate up to 12,000 characters at a time." }, 413, headers);
        if (!allowedLanguages.includes(targetLanguage)) return json({ error: "Unsupported target language." }, 400, headers);
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            temperature: 0.2,
            messages: [
              { role: "system", content: "Translate song lyrics faithfully into the requested target language. Preserve meaning, emotion, line breaks, names and poetic tone. Do not summarize, explain, add commentary, or censor ordinary artistic language. Return only the translated lyrics. For Hindi, use Devanagari script; for Urdu, use Urdu script; for English, use Latin script." },
              { role: "user", content: "Source language: " + sourceLanguage + "\\nTarget language: " + targetLanguage + "\\n\\nLyrics:\\n" + text }
            ]
          })
        });
        const result = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          const status = upstream.status === 429 ? 429 : (upstream.status >= 500 ? 502 : upstream.status);
          return json({ error: result.error?.message || "Translation failed." }, status, headers);
        }
        const translation = result.choices?.[0]?.message?.content?.trim() || "";
        return json({ translation }, 200, headers);
      } catch (error) {
        return json({ error: error?.message || "Unable to translate lyrics." }, 500, headers);
      }
    }
    if (url.pathname !== "/api/transcribe") return json({ error: "Not found" }, 404, headers);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
    if (!env.GROQ_API_KEY) return json({ error: "Groq API key is not configured." }, 503, headers);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 26 * 1024 * 1024) return json({ error: "File exceeds the 25 MB limit." }, 413, headers);
    try {
      const incoming = await request.formData();
      const file = incoming.get("file");
      if (!(file instanceof File) || !file.size) return json({ error: "Please upload an audio or video file." }, 400, headers);
      if (file.size > 25 * 1024 * 1024) return json({ error: "File exceeds the 25 MB limit." }, 413, headers);
      const payload = new FormData();
      payload.append("file", file, file.name || "media");
      payload.append("model", "whisper-large-v3-turbo");
      payload.append("response_format", "verbose_json");
      payload.append("temperature", "0");
      const upstream = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: "Bearer " + env.GROQ_API_KEY }, body: payload
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const status = upstream.status === 429 ? 429 : (upstream.status >= 500 ? 502 : upstream.status);
        return json({ error: upstream.status === 429 ? "Groq free-tier rate limit reached. Try again later." : (result.error?.message || "Speech recognition failed.") }, status, headers);
      }
      return json({ text: result.text || "", language: result.language || null }, 200, headers);
    } catch (error) {
      return json({ error: error?.message || "Unable to process this media file." }, 500, headers);
    }
  }
};

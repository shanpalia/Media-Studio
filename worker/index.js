const ALLOWED_ORIGIN = "https://shanpalia.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Media Studio Speech-to-Text", configured: Boolean(env.GROQ_API_KEY) }, 200, headers);
    }
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
        method: "POST",
        headers: { Authorization: "Bearer " + env.GROQ_API_KEY },
        body: payload
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

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...extraHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

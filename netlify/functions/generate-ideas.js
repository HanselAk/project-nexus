// netlify/functions/generate-ideas.js

const OPENAI_URL = "https://api.openai.com/v1/responses";

// Keep this under Netlify’s limit. (Free tier commonly ~10s)
const UPSTREAM_TIMEOUT_MS = 9000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function extractResponseText(data) {
  try {
    if (data?.output?.length) {
      const chunks = [];
      for (const item of data.output) {
        const content = item?.content || [];
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") {
            chunks.push(c.text);
          }
        }
      }
      return chunks.join("\n").trim();
    }
  } catch {}
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return "";
}

// Very small allow-list so random/old models don't break calls
function normalizeModel(m) {
  const allowed = new Set(["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"]);
  return allowed.has(m) ? m : "gpt-4.1-mini";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") {
    return json(405, { error: { message: "Method not allowed. Use POST." } });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, {
        error: { message: "API key not configured. Set OPENAI_API_KEY in Netlify environment variables." },
      });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: { message: "Invalid JSON body." } });
    }

    const model = normalizeModel(body.model);
    let prompt = String(body.prompt || "").trim();
    if (!prompt) return json(400, { error: { message: "Missing prompt." } });

    // Keep prompt size sane
    if (prompt.length > 12000) prompt = prompt.slice(0, 12000);

    // Force JSON-only output by instruction (works reliably with parsing below)
    const system = [
      "You are an expert senior design project advisor.",
      "Return JSON ONLY. No markdown. No commentary.",
      "Follow the exact schema requested by the user prompt.",
      "Do NOT include trailing commas.",
    ].join(" ");

    const payload = {
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      temperature: 0.4,
      max_output_tokens: 650, // enough for 2–3 ideas in compact JSON
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let resp;
    try {
      resp = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await resp.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return json(502, {
        error: {
          message: `Upstream returned non-JSON (status ${resp.status}).`,
          details: raw.slice(0, 300),
        },
      });
    }

    if (!resp.ok) {
      const msg = data?.error?.message || data?.message || `OpenAI API error (${resp.status})`;
      return json(resp.status, { error: { message: msg, details: data } });
    }

    const ideasText = extractResponseText(data);
    if (!ideasText) {
      return json(500, { error: { message: "OpenAI returned empty text.", details: data } });
    }

    // ✅ Parse the model output as JSON for the frontend
    let ideasJson;
    try {
      ideasJson = JSON.parse(ideasText);
    } catch (e) {
      return json(500, {
        error: {
          message: "Model did not return valid JSON. Lower idea count/detail level and try again.",
          details: ideasText.slice(0, 300),
        },
      });
    }

    // Basic schema check
    if (!ideasJson || !Array.isArray(ideasJson.ideas)) {
      return json(500, {
        error: {
          message: "JSON schema invalid: expected { ideas: [...] }",
          details: ideasJson,
        },
      });
    }

    return json(200, { ideasJson, ideasText, modelUsed: model });
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? "Upstream timed out. Reduce idea count/detail level and try again."
        : err?.message || "Server error";
    return json(504, { error: { message: msg } });
  }
};

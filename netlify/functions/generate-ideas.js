// netlify/functions/generate-ideas.js

const OPENAI_URL = "https://api.openai.com/v1/responses";

// Netlify Functions often time out if the upstream call is slow.
// We'll enforce our own timeout so we can return JSON instead of Netlify returning HTML.
const UPSTREAM_TIMEOUT_MS = 8000; // 8s (stay under Netlify kill window)

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
  // Responses API usually returns text in output[].content[]
  try {
    if (data?.output?.length) {
      const chunks = [];
      for (const item of data.output) {
        const content = item?.content || [];
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") chunks.push(c.text);
        }
      }
      return chunks.join("\n").trim();
    }
  } catch {}
  // fallback
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return "";
}

exports.handler = async (event) => {
  // CORS preflight
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

    // Your frontend sends: { model, prompt }
    const model = body.model || "gpt-4.1-mini";

    // IMPORTANT: keep prompt size under control (huge prompts slow responses)
    let prompt = String(body.prompt || "").trim();
    if (!prompt) return json(400, { error: { message: "Missing prompt." } });

    // Hard cap prompt length to avoid timeouts (you can adjust if needed)
    if (prompt.length > 12000) prompt = prompt.slice(0, 12000);

    // IMPORTANT: keep output tokens lower so it finishes before Netlify times out
    const payload = {
      model,
      input: [
        {
          role: "system",
          content:
            "You are an expert senior-design project advisor. Return concise, compact project ideas. Use clear headings and short bullet points.",
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      // Lower output = faster = fewer Netlify timeouts
      max_output_tokens: 450,
      temperature: 0.7,
    };

    // Enforced timeout
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

    // If OpenAI returns non-JSON for any reason, guard it:
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json(502, {
        error: {
          message: `Upstream returned non-JSON (status ${resp.status}).`,
          details: text.slice(0, 300),
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

    return json(200, { ideasText, modelUsed: model });
  } catch (err) {
    // If we aborted, return a clean JSON error (instead of Netlify HTML timeout)
    const msg =
      err?.name === "AbortError"
        ? "Upstream timed out. Reduce idea count/detail level and try again."
        : err?.message || "Server error";
    return json(504, { error: { message: msg } });
  }
};

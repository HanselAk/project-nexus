// netlify/functions/generate-image.js

const IMG_URL = "https://api.openai.com/v1/images/generations";

function getApiKey() {
  return (process.env.OPENAI_API_KEY || process.env.openai_api_key || "").trim();
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: { message: "Use POST." } });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return json(500, { error: { message: "Missing OPENAI_API_KEY in Netlify env vars." } });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: { message: "Invalid JSON." } });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return json(400, { error: { message: "Missing prompt." } });
  }

  const size = typeof body.size === "string" ? body.size : "1024x1024";

  try {
    const resp = await fetch(IMG_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size,
        // NOTE: do NOT send response_format for gpt-image-1
      }),
    });

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
      return json(resp.status, {
        error: { message: data?.error?.message || "Image API error", details: data },
      });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return json(500, { error: { message: "No image returned.", details: data } });
    }

    return json(200, { imageDataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    return json(500, { error: { message: err?.message || "Server error." } });
  }
};

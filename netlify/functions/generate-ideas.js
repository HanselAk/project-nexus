// netlify/functions/generate-ideas.js
// Netlify serverless function: /.netlify/functions/generate-ideas
//
// Expects JSON body: { model: string, prompt: string }
// Returns: { ideasText: string, modelUsed: string }

const OPENAI_URL = "https://api.openai.com/v1/responses";

// If your HTML dropdown contains older/legacy model names, map them to modern equivalents.
// You can expand this mapping as needed.
function normalizeModel(model) {
  const m = (model || "").trim();

  const map = {
    // common legacy picks from older templates
    "gpt-4": "gpt-4.1",
    "gpt-4-turbo": "gpt-4.1",
    "gpt-4-turbo-preview": "gpt-4.1-mini",
    "gpt-3.5-turbo": "gpt-4o-mini",
    "gpt-3.5-turbo-16k": "gpt-4o-mini",

    // if you already use these, keep them
    "gpt-4.1": "gpt-4.1",
    "gpt-4.1-mini": "gpt-4.1-mini",
    "gpt-4o-mini": "gpt-4o-mini",
    "gpt-4o": "gpt-4o",
  };

  return map[m] || m || "gpt-4.1-mini";
}

function getApiKey() {
  // Support multiple env var names (since you previously mentioned openai_api_key)
  return (
    process.env.OPENAI_API_KEY ||
    process.env.openai_api_key ||
    process.env.OPENAI_APIKEY ||
    ""
  ).trim();
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // If you ever call this function cross-origin, these help.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(obj),
  };
}

function extractResponseText(responsesPayload) {
  // Responses API returns an `output` array with items that contain `content`.
  // We’ll collect any text chunks we can find.
  const out = responsesPayload?.output;
  if (!Array.isArray(out)) return "";

  let text = "";
  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "output_text" && typeof c.text === "string") {
        text += c.text;
      } else if (typeof c?.text === "string") {
        // fallback, just in case schema changes slightly
        text += c.text;
      }
    }
  }
  return text.trim();
}

exports.handler = async (event) => {
  // Handle preflight
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
    return json(405, { error: { message: "Method Not Allowed. Use POST." } });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return json(500, {
      error: {
        message:
          "Missing OpenAI API key. Set environment variable OPENAI_API_KEY (recommended) or openai_api_key in Netlify.",
      },
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: { message: "Invalid JSON body." } });
  }

  const modelRequested = body.model;
  const model = normalizeModel(modelRequested);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return json(400, { error: { message: "Missing prompt." } });
  }

  // Strongly encourage markdown-ish structure so your frontend parser can extract sections.
  // Your displayResults() looks for **Title**, **Problem**, **Key Features**, **Technology Stack**, etc.
  const systemStyle = `
You generate structured project ideas in a consistent format.
Rules:
- Output exactly the requested number of ideas.
- For each idea, ALWAYS include these headings exactly as written:
  **Title**
  **Tagline**
  **Problem**
  **Solution**
  **Target Users**
  **Key Features**
  **Technology Stack**
  **Feasibility**
- If the user prompt asks for extras (roadmap, risks, etc.), include them too.
- Keep each section clear and not overly long.
- Use plain text and bullet lists where appropriate.
`.trim();

  try {
    const payload = {
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemStyle }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      // Keep output reasonable (Netlify functions can time out if this is huge)
      max_output_tokens: 2500,
    };

    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        `OpenAI API error (${resp.status})`;
      return json(resp.status, { error: { message: msg, details: data } });
    }

    const ideasText = extractResponseText(data);
    if (!ideasText) {
      return json(500, {
        error: {
          message:
            "OpenAI returned an empty response. Try again, or reduce requested detail/idea count.",
          details: data,
        },
      });
    }

    return json(200, { ideasText, modelUsed: model });
  } catch (err) {
    return json(500, {
      error: { message: err?.message || "Server error." },
    });
  }
};

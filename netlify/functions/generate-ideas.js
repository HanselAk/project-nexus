// netlify/functions/generate-ideas.js
export async function handler(event) {
  // Basic CORS (safe default)
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: { message: "Method not allowed" } }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const model = body.model || "gpt-4.1-mini";
    const prompt = body.prompt || "";
    const count = Number(body.count || 3);
    const detailLevel = body.detailLevel || "moderate";
    const includeExtras = Boolean(body.includeExtras ?? true);

    // Accept either env var name
    const apiKey = process.env.OPENAI_API_KEY || process.env.openai_api_key;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: {
            message:
              "Missing API key on Netlify. Set OPENAI_API_KEY (recommended) or openai_api_key in Site settings → Environment variables.",
          },
        }),
      };
    }

    // We want COMPACT output like your professor’s cards:
    // Description, Est. Cost, Timeline, Key Components, Technologies, Challenges, Market Appeal, Unique Value
    const system = `You generate senior design project ideas.
Return STRICT JSON ONLY. No markdown. No backticks. No extra commentary.`;

    const user = `
Generate ${count} senior design project ideas.

USER PROMPT / CONSTRAINTS (use these heavily):
${prompt}

OUTPUT RULES:
- Return ONLY JSON with this top-level shape:
{
  "projects": [
    {
      "title": "string",
      "description": "string (compact, 2-4 sentences)",
      "key_components": ["string", "..."],
      "technologies": ["string", "..."],
      "challenges": ["string", "..."],
      "est_cost": "string (like $0-$100, $50-$200, $100-$300 etc.)",
      "timeline": "string (like Months 1-2: ...; Months 3-4: ...)",
      "market_appeal": "string (1-3 sentences)",
      "unique_value": "string (1-3 sentences)"
    }
  ]
}

STYLE:
- Compact + structured (like a rubric card).
- Keep each list 3-6 bullets max.
- Avoid “Project 1/2/3” labels inside fields.
- If info is missing, make reasonable assumptions.
`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: resp.status,
        headers: corsHeaders,
        body: JSON.stringify({
          error: {
            message: `OpenAI error (${resp.status}).`,
            details: errText,
          },
        }),
      };
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";

    // Parse JSON strictly
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // If the model returns something unexpected, still return the raw text for debugging
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          projects: [],
          ideasText: text,
          warning:
            "Model did not return valid JSON. Frontend should log ideasText for debugging.",
        }),
      };
    }

    // Minimal validation/cleanup
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    const cleaned = projects.slice(0, count).map((p) => ({
      title: String(p.title || "Untitled Project").trim(),
      description: String(p.description || "").trim(),
      key_components: Array.isArray(p.key_components) ? p.key_components.slice(0, 6) : [],
      technologies: Array.isArray(p.technologies) ? p.technologies.slice(0, 6) : [],
      challenges: Array.isArray(p.challenges) ? p.challenges.slice(0, 6) : [],
      est_cost: String(p.est_cost || "Not specified").trim(),
      timeline: String(p.timeline || "Not specified").trim(),
      market_appeal: String(p.market_appeal || "").trim(),
      unique_value: String(p.unique_value || "").trim(),
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        projects: cleaned,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: { message: e?.message || "Server error" },
      }),
    };
  }
}

export default async function handler(req, res) {
  // CORS (so GitHub Pages can call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on server" });
    }

    const { prompt, model } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt (string)" });
    }

    // Keep model simple & safe: allow only a small set
    const allowedModels = new Set(["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]);
    const chosenModel = allowedModels.has(model) ? model : "gpt-4.1-mini";

    // Add a system instruction server-side so your client can't remove it.
    const systemInstruction =
      "You are an expert innovation consultant and senior project advisor. " +
      "Generate detailed, practical, creative ideas that match the provided parameters. " +
      "Be technically sound and actionable.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chosenModel,
        input: [
          {
            role: "system",
            content: [{ type: "text", text: systemInstruction }],
          },
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
        temperature: 0.85,
        max_output_tokens: 2500,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    // Best-effort extraction of text from the Responses API structure
    let ideasText = "";
    if (typeof data.output_text === "string") {
      ideasText = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c && c.type === "output_text" && typeof c.text === "string") {
              ideasText += c.text;
            }
          }
        }
      }
    }

    if (!ideasText) {
      ideasText = JSON.stringify(data, null, 2);
    }

    return res.status(200).json({ ideasText });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}

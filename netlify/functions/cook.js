const MODEL = "gemini-2.5-flash";

function cleanIngredient(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function buildPrompt(ingredients) {
  const list = ingredients.map((x) => `- ${x}`).join("\n");
  return [
    "You are Fridge Hero, a helpful chef.",
    "Create ONE fancy dish name and a simple recipe with EXACTLY 3 steps.",
    "Use the ingredients below as the main components (you may add common pantry items like salt, pepper, oil, water).",
    "Keep steps short and beginner-friendly.",
    "",
    "Return STRICT JSON only (no markdown fences, no extra text) in this format:",
    '{ "dishName": "…", "steps": ["step 1", "step 2", "step 3"] }',
    "",
    "Ingredients:",
    list,
  ].join("\n");
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "Missing GEMINI_API_KEY environment variable on Netlify." });
    }

    let payload;
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }

    const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients.map(cleanIngredient).filter(Boolean) : [];
    if (ingredients.length === 0) {
      return json(400, { error: "Provide ingredients as an array of strings." });
    }

    const prompt = buildPrompt(ingredients);

    const endpoint =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(MODEL) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    const textBody = await resp.text();
    if (!resp.ok) {
      return json(resp.status, { error: "Gemini request failed", details: textBody });
    }

    let data;
    try {
      data = JSON.parse(textBody);
    } catch {
      return json(502, { error: "Bad response from Gemini (non-JSON)." });
    }

    const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      return json(502, { error: "Gemini returned no text." });
    }

    // Try strict JSON first (as instructed by prompt); otherwise send raw text to client fallback.
    let parsed = null;
    try {
      parsed = JSON.parse(String(resultText).trim());
    } catch {
      parsed = null;
    }

    if (parsed?.dishName && Array.isArray(parsed?.steps)) {
      return json(200, { dishName: parsed.dishName, steps: parsed.steps });
    }

    return json(200, { text: resultText });
  } catch (err) {
    return json(500, { error: "Server error", details: err?.message || String(err) });
  }
};

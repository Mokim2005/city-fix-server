const { GoogleGenAI } = require("@google/genai");

async function generateDescription({ title, category, location }) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const prompt = `
You are a civic issue reporting assistant.

Title: ${title}
Category: ${category}
Location: ${location}

Write a professional 80-120 word complaint describing:
- The issue clearly
- Impact on citizens
- Urgency for authority action

Return only the description text.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const description = response.text;
    if (!description) {
      throw new Error("Empty or blocked response from Gemini");
    }
    return description.trim();
  } catch (error) {
    console.error("🔥 FULL GEMINI ERROR:", error);
    throw new Error("Failed to generate description");
  }
}

module.exports = { generateDescription };
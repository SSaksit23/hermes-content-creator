import { GoogleGenAI, Type } from "@google/genai";
import { withRetry } from "./retry.js";
import {
  buildContentRequest,
  buildEntityExtractionPrompt,
  parseDataUrl,
} from "./prompts.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";

let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set on the server");
    }
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/* ------------------------------------------------------------------ */
/*  Entity extraction                                                  */
/* ------------------------------------------------------------------ */

export async function extractEntitiesFromDocument({
  documentText = "",
  documentImages = [],
  inputLanguage,
}) {
  const apiCall = async () => {
    const ai = getClient();
    const parts = [];
    const basePrompt = buildEntityExtractionPrompt(inputLanguage);

    if (documentImages.length > 0) {
      parts.push({
        text: `${basePrompt}\n\nThe document is provided as a series of IMAGES. Analyze them carefully.`,
      });
      for (const dataUrl of documentImages) {
        const parsed = parseDataUrl(dataUrl);
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        }
      }
    } else {
      parts.push({
        text: `${basePrompt}\n\nDocument Content:\n---\n${documentText}\n---`,
      });
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "The name of the city, attraction, or meal." },
              type: {
                type: Type.STRING,
                description: 'The type of the entity, either "City", "Attraction", or "Meal".',
              },
              day: {
                type: Type.STRING,
                description: "The day or date associated with this entity (e.g., 'Day 1', '第一天').",
              },
              disambiguationQuery: {
                type: Type.STRING,
                description:
                  "A highly specific Google Search query to uniquely identify this entity.",
              },
            },
            required: ["name", "type", "disambiguationQuery"],
          },
        },
      },
    });

    const jsonText = (response.text || "").trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => item.type === "City" || item.type === "Attraction" || item.type === "Meal",
    );
  };

  return withRetry(apiCall);
}

/* ------------------------------------------------------------------ */
/*  Travel-content generation                                          */
/* ------------------------------------------------------------------ */

function toGeminiRequest(params) {
  const { systemInstruction, parts: abstractParts, generation, useWebSearch } =
    buildContentRequest(params);

  const parts = abstractParts.map((p) =>
    p.text !== undefined
      ? { text: p.text }
      : { inlineData: { mimeType: p.image.mimeType, data: p.image.data } },
  );

  const config = {
    systemInstruction,
    temperature: generation.temperature,
    topP: generation.topP,
    maxOutputTokens: generation.maxOutputTokens,
  };
  if (useWebSearch) {
    config.tools = [{ googleSearch: {} }];
  }
  return { parts, config };
}

function extractSources(response) {
  const groundingChunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = groundingChunks
    .map((chunk) => ({ uri: chunk.web?.uri, title: chunk.web?.title || chunk.web?.uri }))
    .filter((s) => s.uri);
  return Array.from(new Map(sources.map((s) => [s.uri, s])).values());
}

/**
 * Non-streaming content generation. Returns { text, sources }.
 */
export async function generateTravelContent(params) {
  const { parts, config } = toGeminiRequest(params);
  const apiCall = async () => {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config,
    });
    return { text: response.text || "", sources: extractSources(response) };
  };
  return withRetry(apiCall);
}

/**
 * Streaming content generation. Calls `onDelta(textDelta)` for each chunk,
 * then resolves with the final `{ sources }`.
 */
export async function streamTravelContent(params, { onDelta }) {
  const { parts, config } = toGeminiRequest(params);
  const apiCall = async () => {
    const ai = getClient();
    const stream = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: { parts },
      config,
    });
    let finalResponse = null;
    for await (const chunk of stream) {
      if (chunk.text) onDelta(chunk.text);
      finalResponse = chunk;
    }
    return { sources: extractSources(finalResponse) };
  };
  return withRetry(apiCall);
}

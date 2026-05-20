import OpenAI from "openai";
import { withRetry } from "./retry.js";
import {
  buildContentRequest,
  buildEntityExtractionPrompt,
} from "./prompts.js";
import { tavilySearch, formatSearchResultsForPrompt } from "./tavily.js";
import { sanitizeText, createStreamSanitizer } from "./sanitize.js";
import { getRouteBetween, formatLegHeader, formatLegForPrompt } from "./routing.js";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const TAVILY_MAX_RESULTS = Number.parseInt(process.env.TAVILY_MAX_RESULTS || "8", 10);
const TAVILY_DEPTH = process.env.TAVILY_SEARCH_DEPTH || "advanced";

let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set on the server");
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/* ------------------------------------------------------------------ */
/*  Helpers: provider-neutral parts -> OpenAI Responses API content    */
/* ------------------------------------------------------------------ */

function partsToUserMessageContent(parts) {
  const content = [];
  for (const p of parts) {
    if (p.text !== undefined) {
      content.push({ type: "input_text", text: p.text });
    } else if (p.image) {
      const dataUrl = `data:${p.image.mimeType};base64,${p.image.data}`;
      content.push({ type: "input_image", image_url: dataUrl });
    }
  }
  return content;
}

/* ------------------------------------------------------------------ */
/*  Entity extraction (structured JSON via json_schema)                */
/* ------------------------------------------------------------------ */

const ENTITY_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "type", "day", "disambiguationQuery"],
    properties: {
      name: { type: "string", description: "The name of the city, attraction, or meal." },
      type: {
        type: "string",
        enum: ["City", "Attraction", "Meal"],
        description: "The type of the entity.",
      },
      day: {
        type: ["string", "null"],
        description:
          "The day or date associated with this entity (e.g., 'Day 1', '第一天'). Use null if not part of an itinerary.",
      },
      disambiguationQuery: {
        type: "string",
        description: "A highly specific Google Search query to uniquely identify this entity.",
      },
    },
  },
};

export async function extractEntitiesFromDocument({
  documentText = "",
  documentImages = [],
  inputLanguage,
}) {
  const apiCall = async () => {
    const client = getClient();
    const basePrompt = buildEntityExtractionPrompt(inputLanguage);

    const userContent = [];
    if (documentImages.length > 0) {
      userContent.push({
        type: "input_text",
        text: `${basePrompt}\n\nThe document is provided as a series of IMAGES. Analyze them carefully.`,
      });
      for (const dataUrl of documentImages) {
        userContent.push({ type: "input_image", image_url: dataUrl });
      }
    } else {
      userContent.push({
        type: "input_text",
        text: `${basePrompt}\n\nDocument Content:\n---\n${documentText}\n---`,
      });
    }

    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [{ role: "user", content: userContent }],
      text: {
        format: {
          type: "json_schema",
          name: "travel_entities",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["entities"],
            properties: { entities: ENTITY_SCHEMA },
          },
        },
      },
    });

    const jsonText = (response.output_text || "").trim();
    if (!jsonText) return [];
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.warn("[openai] entity extraction returned non-JSON:", jsonText.slice(0, 200));
      return [];
    }
    const arr = Array.isArray(parsed?.entities) ? parsed.entities : [];
    return arr
      .filter(
        (item) => item?.type === "City" || item?.type === "Attraction" || item?.type === "Meal",
      )
      .map((item) => {
        if (item.day === null || item.day === "") {
          const { day: _drop, ...rest } = item;
          return rest;
        }
        return item;
      });
  };

  return withRetry(apiCall);
}

/* ------------------------------------------------------------------ */
/*  Travel-content generation                                          */
/* ------------------------------------------------------------------ */

/**
 * Run Tavily searches when RAG is enabled and merge results.
 * For cross-script subjects (e.g. Chinese input -> Thai output) we run a
 * second pass on the original-script query so we surface native sources.
 */
async function fetchSearchOutcome(params) {
  const userInput = (params.userInput || "").trim();
  const disambig = (params.disambiguationQuery || "").trim();
  const primaryQuery = disambig || userInput;
  if (!primaryQuery) return { results: [], sources: [], answer: null, error: "no query" };

  const queries = [primaryQuery];
  // If the original userInput uses a non-Latin script and is different from the
  // disambiguation query (which is usually English/Latin), search both.
  const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(userInput);
  const hasThai = /[\u0e00-\u0e7f]/.test(userInput);
  const primaryIsLatin = /^[\x00-\x7f]+$/.test(primaryQuery);
  if (userInput && userInput !== primaryQuery && (hasCJK || hasThai) && primaryIsLatin) {
    queries.push(userInput);
  }

  const outcomes = await Promise.all(
    queries.map((q) =>
      tavilySearch(q, {
        maxResults: TAVILY_MAX_RESULTS,
        searchDepth: TAVILY_DEPTH,
      }),
    ),
  );

  // Merge: dedupe by URL, keep first occurrence.
  const seen = new Set();
  const mergedResults = [];
  let answer = null;
  let firstError = null;
  for (const o of outcomes) {
    if (!answer && o.answer) answer = o.answer;
    if (!firstError && o.error) firstError = o.error;
    for (const r of o.results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      mergedResults.push(r);
    }
  }
  const sources = mergedResults.map((r) => ({ uri: r.url, title: r.title }));
  return {
    results: mergedResults.slice(0, TAVILY_MAX_RESULTS * 2),
    sources,
    answer,
    error: mergedResults.length === 0 ? firstError : null,
  };
}

function buildResponsesParams(params, searchContext, previousLeg) {
  const { systemInstruction, parts, generation } = buildContentRequest({
    ...params,
    searchContext,
    previousLeg,
  });

  return {
    model: OPENAI_MODEL,
    instructions: systemInstruction,
    input: [{ role: "user", content: partsToUserMessageContent(parts) }],
    temperature: generation.temperature,
    top_p: generation.topP,
    max_output_tokens: generation.maxOutputTokens,
  };
}

/**
 * Resolve the previousEntity hint into an OSRM leg + the language-neutral
 * fact string we inject into the prompt. Returns `{ leg, promptFact }` where
 * both are nullable so callers can skip the header gracefully.
 */
async function resolvePreviousLeg(params) {
  const prev = params.previousEntity;
  if (!prev) return { leg: null, promptFact: null };
  const prevQuery = (prev.disambiguationQuery || prev.name || "").trim();
  const currentQuery = (params.disambiguationQuery || params.userInput || "").trim();
  if (!prevQuery || !currentQuery) return { leg: null, promptFact: null };
  const leg = await getRouteBetween(prevQuery, currentQuery, {
    outputLanguage: params.outputLanguage,
  });
  if (!leg) return { leg: null, promptFact: null };
  // Use display-friendly names (entity.name) for the header rather than the
  // longer disambiguation query.
  leg.fromName = prev.name || leg.fromName;
  leg.toName = params.userInput || leg.toName;
  return { leg, promptFact: formatLegForPrompt(leg) };
}

/**
 * Non-streaming content generation. Returns { text, sources }.
 */
export async function generateTravelContent(params) {
  const useWebSearch = Boolean(
    params.useRAG ||
      (params.contentType === "Meal Description" &&
        !params.documentContext &&
        (!params.documentImages || params.documentImages.length === 0)),
  );

  // Run search + route lookup in parallel; both can take a few seconds.
  const [searchOutcome, legInfo] = await Promise.all([
    useWebSearch ? fetchSearchOutcome(params) : Promise.resolve(null),
    resolvePreviousLeg(params),
  ]);
  if (searchOutcome?.error) {
    console.warn("[openai] tavily search note:", searchOutcome.error);
  }
  const searchContext = searchOutcome
    ? formatSearchResultsForPrompt(searchOutcome)
    : "";

  const requestParams = buildResponsesParams(params, searchContext, legInfo.promptFact);
  const apiCall = async () => {
    const client = getClient();
    const response = await client.responses.create(requestParams);
    const cleaned = sanitizeText(response.output_text || "");
    const header = formatLegHeader(legInfo.leg, params.outputLanguage);
    const text = header ? `${header}\n\n${cleaned}` : cleaned;
    return {
      text,
      sources: searchOutcome?.sources || [],
    };
  };
  return withRetry(apiCall);
}

/**
 * Streaming content generation. Calls `onDelta(textDelta)` for each chunk,
 * then resolves with the final `{ sources }`.
 */
export async function streamTravelContent(params, { onDelta }) {
  const useWebSearch = Boolean(
    params.useRAG ||
      (params.contentType === "Meal Description" &&
        !params.documentContext &&
        (!params.documentImages || params.documentImages.length === 0)),
  );

  const [searchOutcome, legInfo] = await Promise.all([
    useWebSearch ? fetchSearchOutcome(params) : Promise.resolve(null),
    resolvePreviousLeg(params),
  ]);
  if (searchOutcome?.error) {
    console.warn("[openai] tavily search note:", searchOutcome.error);
  }
  const searchContext = searchOutcome
    ? formatSearchResultsForPrompt(searchOutcome)
    : "";

  const requestParams = buildResponsesParams(params, searchContext, legInfo.promptFact);
  const apiCall = async () => {
    const client = getClient();
    // Emit the distance header as the very first delta so the user sees it
    // before the model's prose begins streaming.
    const header = formatLegHeader(legInfo.leg, params.outputLanguage);
    if (header) onDelta(`${header}\n\n`);

    const stream = await client.responses.stream(requestParams);
    const sanitizer = createStreamSanitizer({ flush: onDelta });
    for await (const event of stream) {
      if (event?.type === "response.output_text.delta" && event.delta) {
        sanitizer.push(event.delta);
      }
    }
    sanitizer.end();
    await stream.finalResponse();
    return { sources: searchOutcome?.sources || [] };
  };
  return withRetry(apiCall);
}

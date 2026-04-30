/**
 * Provider selector. The HTTP route layer (index.js) only imports from here
 * and never references a specific vendor SDK, so swapping providers is a
 * config change (LLM_PROVIDER env var) rather than a code change.
 */

const PROVIDER = (process.env.LLM_PROVIDER || "openai").toLowerCase();

const supported = new Set(["openai", "gemini"]);
if (!supported.has(PROVIDER)) {
  throw new Error(
    `Unsupported LLM_PROVIDER="${PROVIDER}". Expected one of: ${[...supported].join(", ")}`,
  );
}

const driver =
  PROVIDER === "gemini" ? await import("./gemini.js") : await import("./openai.js");

export const activeProvider = PROVIDER;
export const activeModel =
  PROVIDER === "gemini"
    ? process.env.GEMINI_MODEL || "gemini-2.5-pro"
    : process.env.OPENAI_MODEL || "gpt-4o";

export function activeApiKeyConfigured() {
  return PROVIDER === "gemini"
    ? Boolean(process.env.GEMINI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}

export const extractEntitiesFromDocument = driver.extractEntitiesFromDocument;
export const generateTravelContent = driver.generateTravelContent;
export const streamTravelContent = driver.streamTravelContent;

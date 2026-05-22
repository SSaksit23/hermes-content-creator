import express from "express";
import cors from "cors";
import {
  extractEntitiesFromDocument,
  generateTravelContent,
  streamTravelContent,
  activeProvider,
  activeModel,
  activeApiKeyConfigured,
} from "./llm.js";
import { isQuotaError } from "./retry.js";
import { handleGeocodeBatch, handleRoutesBatch } from "./maps.js";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "25mb";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: JSON_BODY_LIMIT }));

if (CORS_ORIGINS.length > 0) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: false }));
  console.log(`[startup] CORS enabled for: ${CORS_ORIGINS.join(", ")}`);
}

const QUOTA_ERROR_MESSAGE =
  "QUOTA_EXCEEDED::You have exceeded your current LLM API quota. Please check your provider plan and billing details, then try again.";

function mapError(err) {
  if (isQuotaError(err)) {
    return { status: 429, body: { error: QUOTA_ERROR_MESSAGE, code: "QUOTA_EXCEEDED" } };
  }
  const msg = err?.message || "Internal server error";
  return { status: 500, body: { error: msg, code: "INTERNAL" } };
}

/* --- Health --- */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: activeProvider,
    model: activeModel,
    apiKeyConfigured: activeApiKeyConfigured(),
    // Kept for backward-compat with any client that still reads this flag.
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    now: new Date().toISOString(),
  });
});

/* --- Extract entities --- */
async function handleExtractEntities(req, res) {
  try {
    const { documentText, documentImages, inputLanguage } = req.body || {};
    if (!inputLanguage) {
      return res.status(400).json({ error: "inputLanguage is required", code: "BAD_REQUEST" });
    }
    const entities = await extractEntitiesFromDocument({
      documentText: documentText || "",
      documentImages: Array.isArray(documentImages) ? documentImages : [],
      inputLanguage,
    });
    res.json({ entities });
  } catch (err) {
    console.error("[extract-entities]", err);
    const { status, body } = mapError(err);
    res.status(status).json(body);
  }
}

/* --- Generate content (JSON) --- */
async function handleGenerateContent(req, res) {
  try {
    const result = await generateTravelContent(req.body || {});
    res.json(result);
  } catch (err) {
    console.error("[generate-content]", err);
    const { status, body } = mapError(err);
    res.status(status).json(body);
  }
}

/* --- Generate content (NDJSON streaming) --- */
async function handleGenerateContentStream(req, res) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (obj) => {
    res.write(JSON.stringify(obj) + "\n");
  };

  try {
    const { sources } = await streamTravelContent(req.body || {}, {
      onDelta: (delta) => send({ type: "delta", delta }),
    });
    send({ type: "final", sources });
    res.end();
  } catch (err) {
    console.error("[generate-content/stream]", err);
    const { body } = mapError(err);
    send({ type: "error", ...body });
    res.end();
  }
}

// New provider-neutral routes...
app.post("/api/llm/extract-entities", handleExtractEntities);
app.post("/api/llm/generate-content", handleGenerateContent);
app.post("/api/llm/generate-content/stream", handleGenerateContentStream);

// ...and legacy /api/gemini/* aliases so the SPA keeps working without changes.
app.post("/api/gemini/extract-entities", handleExtractEntities);
app.post("/api/gemini/generate-content", handleGenerateContent);
app.post("/api/gemini/generate-content/stream", handleGenerateContentStream);

// Map data: batch geocoding + batch road routes for the MapView.
app.post("/api/maps/geocode", handleGeocodeBatch);
app.post("/api/maps/routes", handleRoutesBatch);

app.use((_req, res) => res.status(404).json({ error: "Not found", code: "NOT_FOUND" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[startup] LLM proxy listening on :${PORT} (provider=${activeProvider}, model=${activeModel})`,
  );
  if (!activeApiKeyConfigured()) {
    const expected = activeProvider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    console.warn(`[startup] WARNING: ${expected} is not set; calls will fail at runtime`);
  }
});

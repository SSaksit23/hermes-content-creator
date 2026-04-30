/**
 * Minimal Tavily search client. Used by the OpenAI driver to pre-fetch
 * web research results before calling the LLM (classic RAG: retrieve, then
 * generate). Replaces OpenAI's built-in web_search tool because:
 *   - Tavily is always called when useRAG is true (no model-side opt-out).
 *   - The proxy controls query, depth, result count, and per-locale tuning.
 *   - The same search snippets feed both the prompt context and the SPA's
 *     Source[] panel, so what the user sees cited matches what the model saw.
 *
 * Docs: https://docs.tavily.com/docs/rest-api/api-reference
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/**
 * @typedef {Object} TavilyResult
 * @property {string} title
 * @property {string} url
 * @property {string} [content]   Snippet returned by Tavily.
 * @property {number} [score]     Relevance score 0..1.
 */

/**
 * @typedef {Object} SearchOutcome
 * @property {TavilyResult[]} results  Raw results (with snippets) for prompt injection.
 * @property {{uri:string,title:string}[]} sources  Compact form for SPA Source[] panel.
 * @property {string|null} answer  Short synthesised answer if Tavily provided one.
 * @property {string|null} error   Human-readable failure note (network, auth, etc.).
 */

/**
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.maxResults=8]
 * @param {"basic"|"advanced"} [opts.searchDepth="advanced"]
 * @param {string[]} [opts.includeDomains]
 * @param {string[]} [opts.excludeDomains]
 * @param {boolean} [opts.includeAnswer=true]
 * @param {number} [opts.timeoutMs=20000]
 * @returns {Promise<SearchOutcome>}
 */
export async function tavilySearch(query, opts = {}) {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return {
      results: [],
      sources: [],
      answer: null,
      error: "TAVILY_API_KEY is not set on the server",
    };
  }
  if (!query || !query.trim()) {
    return { results: [], sources: [], answer: null, error: "empty query" };
  }

  const body = {
    api_key: apiKey,
    query: query.trim(),
    search_depth: opts.searchDepth || "advanced",
    max_results: opts.maxResults || 8,
    include_answer: opts.includeAnswer !== false,
    include_raw_content: false,
    include_images: false,
  };
  if (Array.isArray(opts.includeDomains) && opts.includeDomains.length > 0) {
    body.include_domains = opts.includeDomains;
  }
  if (Array.isArray(opts.excludeDomains) && opts.excludeDomains.length > 0) {
    body.exclude_domains = opts.excludeDomains;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      return {
        results: [],
        sources: [],
        answer: null,
        error: `Tavily HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    const data = await res.json();
    const rawResults = Array.isArray(data?.results) ? data.results : [];
    const results = rawResults
      .filter((r) => r && r.url)
      .map((r) => ({
        title: r.title || r.url,
        url: r.url,
        content: r.content || "",
        score: typeof r.score === "number" ? r.score : null,
      }));

    // Deduplicate by URL for the Source[] panel.
    const seen = new Set();
    const sources = [];
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      sources.push({ uri: r.url, title: r.title });
    }

    return {
      results,
      sources,
      answer: typeof data?.answer === "string" ? data.answer : null,
      error: null,
    };
  } catch (err) {
    return {
      results: [],
      sources: [],
      answer: null,
      error: `Tavily fetch failed: ${err?.message || String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render Tavily results into a compact, model-friendly research dossier.
 * Each item is numbered so the model can cite by [n] when useful.
 */
export function formatSearchResultsForPrompt(outcome, { maxChars = 12000 } = {}) {
  if (!outcome || !outcome.results.length) return "";

  const lines = [];
  if (outcome.answer) {
    lines.push("**Tavily synthesised answer:**");
    lines.push(outcome.answer.trim());
    lines.push("");
  }
  lines.push("**Tavily search results (use these as your primary factual source):**");
  outcome.results.forEach((r, i) => {
    const snippet = (r.content || "").trim().replace(/\s+/g, " ");
    lines.push(
      `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    Snippet: ${snippet || "(no snippet)"}`,
    );
  });
  let joined = lines.join("\n");
  if (joined.length > maxChars) {
    joined = joined.slice(0, maxChars) + "\n…(truncated)";
  }
  return joined;
}

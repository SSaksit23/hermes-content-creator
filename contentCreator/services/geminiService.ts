/// <reference types="vite/client" />
import supabaseManager from './supabaseService';
import { ContentType, Language, Source } from '../types';
import { sanitizeText } from './sanitize';

// Bump when the prompt or output post-processing pipeline changes so prior
// cache rows are bypassed instead of replayed verbatim.
//   v2 — server-side sanitizer added, source URLs stripped
//   v3 — opening-paragraph guidance overhauled (no more "wind on the face")
//   v4 — OSRM "distance from previous stop" header injected per item
const POST_PROCESS_VERSION = 'v4-distance-header';

/**
 * The client no longer talks to any LLM directly — all calls go through the
 * backend proxy so the API key never ships to the browser. The proxy can be
 * pointed at OpenAI (default) or Gemini via the LLM_PROVIDER server env var.
 *
 * The Supabase cache stays on the client (it already has anon-key level access
 * and caching is an optimization, not a secret). Prompt construction, retry
 * policy and grounding extraction all live server-side.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

const QUOTA_ERROR_MESSAGE =
    'QUOTA_EXCEEDED::You have exceeded your current LLM API quota. Please check your provider plan and billing details, then try again.';

interface HealthInfo {
    provider: string;
    model: string;
    apiKeyConfigured: boolean;
}

let _healthCache: Promise<HealthInfo> | null = null;
async function getActiveProvider(): Promise<HealthInfo> {
    if (!_healthCache) {
        _healthCache = (async () => {
            try {
                const res = await fetch(`${API_BASE}/health`);
                if (!res.ok) throw new Error(`health ${res.status}`);
                const data = await res.json();
                return {
                    provider: typeof data.provider === 'string' ? data.provider : 'unknown',
                    model: typeof data.model === 'string' ? data.model : 'unknown',
                    apiKeyConfigured: Boolean(data.apiKeyConfigured),
                };
            } catch {
                // Treat health-check failure as unknown rather than blocking
                // generation; the cache key just won't include a provider tag
                // for this session.
                return { provider: 'unknown', model: 'unknown', apiKeyConfigured: false };
            }
        })();
    }
    return _healthCache;
}

async function readJsonError(res: Response): Promise<{ error?: string; code?: string } | null> {
    try {
        return (await res.json()) as { error?: string; code?: string };
    } catch {
        return null;
    }
}

const createQueryHash = async (text: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const hashDataUrl = async (dataUrl: string): Promise<string> => createQueryHash(dataUrl);

interface ExtractedEntity {
    name: string;
    type: 'City' | 'Attraction' | 'Meal';
    day?: string;
    disambiguationQuery: string;
}

interface ExtractEntitiesParams {
    documentText: string;
    documentImages: string[];
    inputLanguage: Language;
}

export const extractEntitiesFromDocument = async ({
    documentText,
    documentImages,
    inputLanguage,
}: ExtractEntitiesParams): Promise<ExtractedEntity[]> => {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}/gemini/extract-entities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentText, documentImages, inputLanguage }),
        });
    } catch (err) {
        console.error('Network error contacting LLM proxy:', err);
        throw new Error('Failed to reach the LLM proxy. Is the backend running?');
    }

    if (!res.ok) {
        const payload = await readJsonError(res);
        if (res.status === 429 || payload?.code === 'QUOTA_EXCEEDED') {
            throw new Error(QUOTA_ERROR_MESSAGE);
        }
        console.error('Error extracting entities via proxy:', payload);
        throw new Error(payload?.error || 'Failed to analyze the document with the LLM API.');
    }

    const data = (await res.json()) as { entities: ExtractedEntity[] };
    return Array.isArray(data.entities) ? data.entities : [];
};

interface PreviousEntityHint {
    name: string;
    disambiguationQuery: string;
}

interface GenerateContentParams {
    contentType: ContentType;
    inputLanguage: Language;
    outputLanguage: Language;
    userInput: string;
    disambiguationQuery: string;
    useRAG: boolean;
    documentContext: string;
    documentImages: string[];
    tone: string;
    socialPlatform?: string;
    talkingPoints?: string;
    day?: string;
    previousEntity?: PreviousEntityHint;
    onChunk?: (text: string) => void;
}

/**
 * Read an NDJSON stream from the proxy and forward deltas to `onChunk`.
 * Returns the final `{ text, sources }` once the stream closes.
 */
async function consumeNdjsonStream(
    res: Response,
    onChunk?: (text: string) => void,
): Promise<{ text: string; sources: Source[] }> {
    if (!res.body) throw new Error('Proxy returned an empty response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let sources: Source[] = [];

    const handleEvent = (line: string) => {
        if (!line.trim()) return;
        let event: { type?: string; delta?: string; sources?: Source[]; error?: string; code?: string };
        try {
            event = JSON.parse(line);
        } catch {
            console.warn('Non-JSON line from proxy stream:', line);
            return;
        }
        if (event.type === 'delta' && event.delta) {
            fullText += event.delta;
            if (onChunk) onChunk(fullText);
        } else if (event.type === 'final' && Array.isArray(event.sources)) {
            sources = event.sources;
        } else if (event.type === 'error') {
            if (event.code === 'QUOTA_EXCEEDED') throw new Error(QUOTA_ERROR_MESSAGE);
            throw new Error(event.error || 'LLM proxy returned an error');
        }
    };

    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            handleEvent(line);
            newlineIndex = buffer.indexOf('\n');
        }
    }
    if (buffer.trim()) handleEvent(buffer);

    return { text: fullText, sources };
}

export const generateTravelContent = async ({
    contentType,
    inputLanguage,
    outputLanguage,
    userInput,
    disambiguationQuery,
    useRAG,
    documentContext,
    documentImages,
    tone,
    socialPlatform,
    talkingPoints,
    day,
    previousEntity,
    onChunk,
}: GenerateContentParams): Promise<{ text: string; sources: Source[] }> => {
    const imageSignatures = await Promise.all(documentImages.map(img => hashDataUrl(img)));
    const { provider, model } = await getActiveProvider();
    const queryParams = {
        contentType,
        inputLanguage,
        outputLanguage,
        userInput,
        disambiguationQuery,
        useRAG,
        tone,
        documentContext,
        imageSignature: imageSignatures.join('-'),
        socialPlatform,
        talkingPoints,
        day,
        // Include the previous-stop hint in the cache key so two items on
        // different days (or with different predecessors) don't collide.
        previousEntityKey: previousEntity
            ? `${previousEntity.name}::${previousEntity.disambiguationQuery}`
            : '',
        // Bust the cache when the active LLM provider/model changes so we
        // don't serve a Gemini-flavored row to an OpenAI-configured backend
        // (and vice versa).
        provider,
        model,
        // Bust the cache when output post-processing changes so legacy rows
        // with inline source URLs are not served verbatim.
        postProcessVersion: POST_PROCESS_VERSION,
    };

    const hashString = JSON.stringify(Object.entries(queryParams).sort());
    const queryHash = await createQueryHash(hashString);
    const supabase = supabaseManager.getClient();

    if (supabase) {
        try {
            const { data: cachedData } = await supabase
                .from('generated_content')
                .select('content, sources')
                .eq('query_hash', queryHash)
                .single();

            if (cachedData) {
                console.log(`Cache hit for "${userInput}"`);
                // Re-sanitize on read so any pre-existing rows that were stored
                // before the server-side sanitizer was added still come out clean.
                const cleaned = sanitizeText(cachedData.content || '');
                if (onChunk) onChunk(cleaned);
                return {
                    text: cleaned,
                    sources: cachedData.sources || [],
                };
            }
        } catch (e) {
            console.error('Error querying Supabase cache:', e);
        }
    }

    console.log(`Cache miss for "${userInput}", generating via proxy...`);

    const requestBody = {
        contentType,
        inputLanguage,
        outputLanguage,
        userInput,
        disambiguationQuery,
        useRAG,
        documentContext,
        documentImages,
        tone,
        socialPlatform,
        talkingPoints,
        day,
        previousEntity,
    };

    const shouldStream = typeof onChunk === 'function';
    const url = shouldStream
        ? `${API_BASE}/gemini/generate-content/stream`
        : `${API_BASE}/gemini/generate-content`;

    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
    } catch (err) {
        console.error('Network error contacting LLM proxy:', err);
        throw new Error('Failed to reach the LLM proxy. Is the backend running?');
    }

    if (!res.ok) {
        const payload = await readJsonError(res);
        if (res.status === 429 || payload?.code === 'QUOTA_EXCEEDED') {
            throw new Error(QUOTA_ERROR_MESSAGE);
        }
        console.error('Error generating content via proxy:', payload);
        throw new Error(payload?.error || 'Failed to communicate with the LLM API.');
    }

    let text: string;
    let sources: Source[];

    if (shouldStream) {
        ({ text, sources } = await consumeNdjsonStream(res, onChunk));
    } else {
        const data = (await res.json()) as { text: string; sources: Source[] };
        text = data.text || '';
        sources = Array.isArray(data.sources) ? data.sources : [];
    }

    // Defense in depth: scrub again on the client in case the user is still
    // running an older backend container that pre-dates the server sanitizer.
    text = sanitizeText(text);

    if (supabase) {
        try {
            await supabase.from('generated_content').insert({
                query_hash: queryHash,
                name: userInput,
                content_type: contentType,
                input_language: inputLanguage,
                output_language: outputLanguage,
                tone: tone,
                use_rag: useRAG,
                content: text,
                sources: sources,
            });
        } catch (e) {
            console.error('Error saving to Supabase cache:', e);
        }
    }

    return { text, sources };
};

/**
 * Nominatim (OpenStreetMap) geocoding helper.
 *
 * Place name -> {lat, lng}. Used by routing.js to turn the previous and
 * current entity names into coordinates before calling OSRM.
 *
 * Constraints:
 *   - Nominatim usage policy: max 1 request per second, identify yourself
 *     via User-Agent. We serialise calls through a global queue so multiple
 *     concurrent generate-content requests do not burst the public endpoint.
 *   - Failures are non-fatal; callers receive `null` and skip the route.
 *
 * Mirrors the lookup pattern in 4. Map intilligent's nominatim-geocode.ts.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || "HermesContentCreator/1.0 (+https://github.com/SSaksit23/hermes-content-creator)";
const MIN_INTERVAL_MS = 1100;
const CACHE_MAX = 500;
const FETCH_TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 5;

const cache = new Map();
let nextSlot = 0;

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, value);
}

function langForOutput(outputLanguage) {
  switch ((outputLanguage || "").toLowerCase()) {
    case "thai":
      return "th";
    case "chinese":
      return "zh";
    case "english":
      return "en";
    default:
      return "en";
  }
}

async function waitForSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** Direct read-through of the cache; null if no entry exists. */
export function getCachedGeocode(query, outputLanguage) {
  const q = (query || "").trim();
  if (!q) return undefined;
  const key = `${langForOutput(outputLanguage)}::${q.toLowerCase()}`;
  return cache.get(key);
}

/**
 * Geocode a place name. Returns `{ lat, lng, displayName }` or `null` if
 * the lookup fails for any reason. Never throws.
 */
export async function geocode(query, { outputLanguage = "English" } = {}) {
  const q = (query || "").trim();
  if (!q) return null;

  const lang = langForOutput(outputLanguage);
  const cacheKey = `${lang}::${q.toLowerCase()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  await waitForSlot();

  const url =
    `${NOMINATIM_URL}?format=json&limit=${SEARCH_LIMIT}&accept-language=${lang}` +
    `&q=${encodeURIComponent(q)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[geocode] nominatim HTTP ${resp.status} for "${q}"`);
      cacheSet(cacheKey, null);
      return null;
    }
    const arr = await resp.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      cacheSet(cacheKey, null);
      return null;
    }
    const r = arr[0];
    const lat = Number.parseFloat(r.lat);
    const lng = Number.parseFloat(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      cacheSet(cacheKey, null);
      return null;
    }
    if (lat === 0 && lng === 0) {
      cacheSet(cacheKey, null);
      return null;
    }
    const result = { lat, lng, displayName: r.display_name || q };
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`[geocode] error for "${q}":`, err?.message || err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

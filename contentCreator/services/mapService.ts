/// <reference types="vite/client" />

/**
 * Client wrappers around the /api/maps/* endpoints used by MapView.
 *
 * These calls run independently of the LLM generation loop: they start the
 * moment the user confirms entities and progressively populate the map while
 * descriptions stream in. Results are cached in-memory keyed by query string
 * (geocode) or by coord pair (routes), so re-opening the Map tab is instant.
 *
 * All functions are non-throwing — failures resolve to partial / empty
 * results so the UI can still render whatever did succeed.
 */

export type LatLng = { lat: number; lng: number };

export interface GeocodeInput {
    id: string;
    name: string;
    disambiguationQuery?: string;
    /** ContentType label (e.g. "Meal Description") — used by the server to
     *  reorder Nominatim query candidates (meals want city context first). */
    type?: string;
    /** Day grouping ("Day 1", "第一天", or empty). Used by the client to
     *  attach the right per-day city anchor. */
    day?: string;
    /** City name to anchor the search to ("Dalian"). The server queries
     *  `${name}, ${cityHint}` first, before any other candidate. */
    cityHint?: string;
    /** Resolved coords of the day's city, if known. The server uses this to
     *  compute `anchorDistanceKm` so the client can flag suspicious results. */
    anchorCoord?: LatLng;
}

export interface GeocodeResult {
    id: string;
    lat?: number;
    lng?: number;
    displayName?: string;
    /** Distance from the supplied `anchorCoord`, in km. Absent if no anchor
     *  was provided or no result was found. */
    anchorDistanceKm?: number;
    error?: string;
}

export interface RouteLegInput {
    fromId: string;
    toId: string;
    day?: string;
    from: LatLng;
    to: LatLng;
    /** Carried through to the result so the UI can flag legs whose endpoints
     *  are far from their day's city anchor (likely wrong geocoding). */
    suspicious?: boolean;
}

export interface RouteLegResult {
    fromId: string;
    toId: string;
    day?: string;
    distanceKm?: number;
    durationMinutes?: number;
    geometry?: [number, number][] | null;
    estimated?: boolean;
    /** True when at least one endpoint resolved >150 km from the day's city
     *  anchor — usually a sign the geocoder hit a same-named place in the
     *  wrong city. The pin and leg are still drawn (lenient policy) but
     *  rendered with a red/italic warning style. */
    suspicious?: boolean;
    error?: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

// query string -> resolved coords (or null if it has been tried and failed).
const geocodeCache = new Map<string, LatLng | null>();
// "lat1,lng1|lat2,lng2" -> route response (geometry kept here for re-renders).
const routeCache = new Map<string, RouteLegResult>();

function geocodeKey(language: string, query: string): string {
    return `${language.toLowerCase()}::${query.trim().toLowerCase()}`;
}

const isCityType = (t?: string) => /city/i.test(t || '');

/**
 * Walk the ordered itinerary and tag every non-City item with its day's city
 * anchor. We use the City entity that appears in the same day; if a day has
 * no explicit City entry, we fall back to the most recent City seen earlier
 * in the itinerary (covers multi-day trips that only declare the city once).
 */
export function attachCityHints<T extends GeocodeInput>(items: T[]): T[] {
    // First pass: cityName per day key (string, since `day` may be undefined).
    const cityByDay = new Map<string, string>();
    for (const it of items) {
        if (!isCityType(it.type)) continue;
        const k = it.day || '';
        if (!cityByDay.has(k) && it.name?.trim()) {
            cityByDay.set(k, it.name.trim());
        }
    }
    // Second pass: tag each non-City item with the city anchor for its day,
    // falling back to the previous day's anchor when the current day doesn't
    // declare one.
    let lastSeenCity: string | undefined;
    return items.map((it) => {
        if (isCityType(it.type)) {
            if (it.name?.trim()) lastSeenCity = it.name.trim();
            return it;
        }
        const dayCity = cityByDay.get(it.day || '');
        const hint = dayCity || lastSeenCity;
        if (!hint) return it;
        return { ...it, cityHint: hint } as T;
    });
}

function routeKey(from: LatLng, to: LatLng): string {
    return `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
}

/**
 * Geocode a list of itinerary items. Internally splits large batches into
 * smaller chunks so pins appear on the map incrementally rather than after
 * a single ~50s round-trip (Nominatim is throttled to ~1 req/sec server-side).
 * If `onChunk` is provided it's invoked after every chunk with the newly
 * resolved coords, so callers can update UI state mid-flight.
 *
 * Returns the merged map of itemId -> LatLng across all chunks.
 */
const GEOCODE_CHUNK_SIZE = 6;

export interface GeocodeItemsResult {
    /** itemId -> resolved coords for every successful lookup. */
    coords: Record<string, LatLng>;
    /** itemId -> distance from the supplied cityAnchor, in km. Absent for
     *  items without an anchor or items that didn't resolve. */
    anchorDistanceKm: Record<string, number>;
}

export type GeocodeProgress = (partial: {
    coords: Record<string, LatLng>;
    anchorDistanceKm: Record<string, number>;
}) => void;

export async function geocodeItems(
    items: GeocodeInput[],
    outputLanguage: string = 'English',
    onChunk?: GeocodeProgress,
): Promise<GeocodeItemsResult> {
    const result: GeocodeItemsResult = { coords: {}, anchorDistanceKm: {} };
    const toFetch: GeocodeInput[] = [];

    // Cache key = bare `name` (server's primary candidate). Different
    // cityHints on the same name still share a cache entry — Nominatim's
    // result rarely changes when only the city hint shifts within the same
    // country, so this is fine; if it does, the user will hit the suspicious
    // flag and can intervene.
    for (const it of items) {
        const q = (it.name || it.disambiguationQuery || '').trim();
        if (!q) continue;
        const key = geocodeKey(outputLanguage, q);
        if (geocodeCache.has(key)) {
            const cached = geocodeCache.get(key);
            if (cached) result.coords[it.id] = cached;
            continue;
        }
        toFetch.push(it);
    }

    if (toFetch.length === 0) return result;

    for (let i = 0; i < toFetch.length; i += GEOCODE_CHUNK_SIZE) {
        const chunk = toFetch.slice(i, i + GEOCODE_CHUNK_SIZE);
        const partialCoords: Record<string, LatLng> = {};
        const partialAnchor: Record<string, number> = {};

        try {
            const res = await fetch(`${API_BASE}/maps/geocode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: chunk, outputLanguage }),
            });
            if (!res.ok) {
                console.warn('[mapService] geocode HTTP', res.status);
                continue;
            }
            const data = (await res.json()) as { items?: GeocodeResult[] };
            const out = Array.isArray(data.items) ? data.items : [];

            for (const input of chunk) {
                const r = out.find((x) => x.id === input.id);
                const query = (input.name || input.disambiguationQuery || '').trim();
                const key = geocodeKey(outputLanguage, query);

                if (r && typeof r.lat === 'number' && typeof r.lng === 'number') {
                    const coords: LatLng = { lat: r.lat, lng: r.lng };
                    geocodeCache.set(key, coords);
                    result.coords[input.id] = coords;
                    partialCoords[input.id] = coords;
                    if (typeof r.anchorDistanceKm === 'number') {
                        result.anchorDistanceKm[input.id] = r.anchorDistanceKm;
                        partialAnchor[input.id] = r.anchorDistanceKm;
                    }
                } else {
                    geocodeCache.set(key, null);
                }
            }
        } catch (err) {
            console.warn('[mapService] geocode chunk failed:', err);
            continue;
        }

        if (onChunk && Object.keys(partialCoords).length > 0) {
            try {
                onChunk({ coords: partialCoords, anchorDistanceKm: partialAnchor });
            } catch {
                /* never let UI errors break the loop */
            }
        }
    }

    return result;
}

/**
 * Look up driving routes (with geometry) for a list of same-day pairs.
 * Returns one entry per successful route; pairs that fail are omitted.
 */
export async function routeLegs(pairs: RouteLegInput[]): Promise<RouteLegResult[]> {
    if (pairs.length === 0) return [];

    const cached: RouteLegResult[] = [];
    const toFetch: RouteLegInput[] = [];

    for (const p of pairs) {
        const key = routeKey(p.from, p.to);
        const hit = routeCache.get(key);
        if (hit) {
            cached.push({
                ...hit,
                fromId: p.fromId,
                toId: p.toId,
                day: p.day,
                // Suspicious is per-itinerary (depends on which day's anchor
                // each endpoint sits next to), so always take the freshly
                // computed value from the input pair, not the coord-pair cache.
                suspicious: p.suspicious || hit.suspicious,
            });
        } else {
            toFetch.push(p);
        }
    }

    if (toFetch.length === 0) return cached;

    try {
        const res = await fetch(`${API_BASE}/maps/routes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                legs: toFetch.map(p => ({
                    fromId: p.fromId,
                    toId: p.toId,
                    from: p.from,
                    to: p.to,
                })),
            }),
        });
        if (!res.ok) {
            console.warn('[mapService] routes HTTP', res.status);
            return cached;
        }
        const data = (await res.json()) as { legs?: RouteLegResult[] };
        const out = Array.isArray(data.legs) ? data.legs : [];

        for (let i = 0; i < toFetch.length; i++) {
            const input = toFetch[i];
            const match = out.find(r => r.fromId === input.fromId && r.toId === input.toId);
            if (!match || match.error) continue;

            const enriched: RouteLegResult = {
                fromId: input.fromId,
                toId: input.toId,
                day: input.day,
                distanceKm: match.distanceKm,
                durationMinutes: match.durationMinutes,
                geometry: match.geometry ?? null,
                estimated: Boolean(match.estimated),
                suspicious: Boolean(input.suspicious),
            };
            // Cache without the per-itinerary `suspicious` flag — that flag
            // depends on the day's anchor, not the coord pair itself.
            const { suspicious: _ignored, ...cacheable } = enriched;
            void _ignored;
            routeCache.set(routeKey(input.from, input.to), cacheable);
            cached.push(enriched);
        }
    } catch (err) {
        console.warn('[mapService] routes failed:', err);
    }

    return cached;
}

/**
 * Build same-day, consecutive (i, i+1) pairs from an ordered item list.
 * Items without resolved coordinates are skipped, breaking the chain at
 * that point. Items with no `day` are treated as their own bucket so a
 * flat itinerary still gets connected.
 */
export function buildSameDayPairs<T extends { id: string; day?: string }>(
    items: T[],
    coords: Record<string, LatLng>,
    suspiciousIds?: ReadonlySet<string>,
): RouteLegInput[] {
    const pairs: RouteLegInput[] = [];
    for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1];
        const curr = items[i];
        if ((prev.day || '') !== (curr.day || '')) continue;
        const from = coords[prev.id];
        const to = coords[curr.id];
        if (!from || !to) continue;
        if (
            Math.abs(from.lat - to.lat) < 1e-5 &&
            Math.abs(from.lng - to.lng) < 1e-5
        ) {
            continue;
        }
        const suspicious = Boolean(
            suspiciousIds && (suspiciousIds.has(prev.id) || suspiciousIds.has(curr.id)),
        );
        pairs.push({
            fromId: prev.id,
            toId: curr.id,
            day: curr.day,
            from,
            to,
            suspicious,
        });
    }
    return pairs;
}

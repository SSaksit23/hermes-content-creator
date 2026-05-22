/**
 * Map-data endpoints: batch geocoding and batch road-route lookup.
 *
 * These power the client-side MapView. They are deliberately tolerant —
 * a single failing entity or leg yields a partial result rather than a
 * 500 response, so the map fills in incrementally as best it can.
 */

import { geocode } from "./geocode.js";
import { getRouteFromCoords } from "./routing.js";

/**
 * Walk a free-form disambiguation string ("中山广场 大连市 辽宁省 China") and
 * extract a 1–2 word city/region tail. The LLM tends to put country last and
 * city near the end, so we drop the country token (heuristic: the very last
 * word) and keep the next 1–2 tokens. Splitting on commas is preferred when
 * present.
 */
function extractCityTail(disamb) {
  if (!disamb) return null;
  if (disamb.includes(",")) {
    const segs = disamb.split(",").map((s) => s.trim()).filter(Boolean);
    if (segs.length <= 1) return null;
    return segs.slice(-2).join(", ");
  }
  const tokens = disamb.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  // Drop the trailing country token if it looks like a country (latin word
  // 4+ letters at the end). Then take the previous 1–2 tokens.
  const tailIsLikelyCountry = /^[A-Za-z]{4,}$/.test(tokens[tokens.length - 1]);
  const usable = tailIsLikelyCountry ? tokens.slice(0, -1) : tokens;
  if (usable.length === 0) return null;
  return usable.slice(-2).join(" ");
}

/**
 * Build an ordered list of Nominatim query candidates for an itinerary item.
 *
 * Priority is now driven by the per-day city anchor (`cityHint`) the client
 * computes from the itinerary's City entities. A bare ambiguous name like
 * "中山广场" matches the famous one in Beijing; with `cityHint = "Dalian"`
 * the first query becomes "中山广场, Dalian" and lands in the right city.
 */
function buildGeocodeCandidates(item) {
  const candidates = [];
  const seen = new Set();
  const push = (v) => {
    if (!v) return;
    const s = String(v).trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(s);
  };

  const name = (item.name || "").trim();
  const disamb = (item.disambiguationQuery || "").trim();
  const cityHint = (item.cityHint || "").trim();
  const isMeal = typeof item.type === "string" && /meal/i.test(item.type);
  const isCity = typeof item.type === "string" && /city/i.test(item.type);

  const cityTail = extractCityTail(disamb);
  const nameWithCityHint = cityHint && name ? `${name}, ${cityHint}` : null;
  const nameWithCityTail = cityTail && name ? `${name}, ${cityTail}` : null;

  if (isCity) {
    // City items themselves: just trust the canonical name. Hinting a city
    // with itself is redundant and can sometimes confuse Nominatim.
    push(name);
    push(disamb);
    return candidates;
  }

  if (isMeal) {
    // Meals: anchor first so we land in the right region rather than at a
    // homonymous restaurant elsewhere.
    push(nameWithCityHint);
    push(nameWithCityTail);
    push(disamb);
    push(name);
    return candidates;
  }

  // Cities / Attractions: the per-day city anchor wins, with bare-name and
  // disamb-derived fallbacks behind it.
  push(nameWithCityHint);
  push(name);
  push(nameWithCityTail);
  if (disamb) {
    const head = disamb.split(/\s+/).slice(0, 4).join(" ");
    push(head);
  }
  push(disamb);
  return candidates;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isValidLatLng(c) {
  return (
    c &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng)
  );
}

/**
 * POST /api/maps/geocode
 *   body: { items: [{ id, name, disambiguationQuery? }], outputLanguage? }
 *   returns: { items: [{ id, lat?, lng?, displayName?, error? }] }
 *
 * The Nominatim 1 req/sec policy is enforced inside geocode.js, so awaiting
 * sequentially gives the smoothest behaviour. Cached hits return instantly.
 */
export async function handleGeocodeBatch(req, res) {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const outputLanguage = body.outputLanguage || "English";

    const results = [];
    for (const item of items) {
      if (!item || typeof item.id !== "string") {
        results.push({ id: String(item?.id ?? ""), error: "invalid item" });
        continue;
      }

      const candidates = buildGeocodeCandidates(item);
      if (candidates.length === 0) {
        results.push({ id: item.id, error: "empty query" });
        continue;
      }

      let hit = null;
      let usedQuery = null;
      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const r = await geocode(candidate, { outputLanguage });
        if (r) {
          hit = r;
          usedQuery = candidate;
          break;
        }
      }

      if (!hit) {
        console.warn(
          `[maps/geocode] no result for "${item.name}" (tried: ${candidates.join(" | ")})`,
        );
        results.push({ id: item.id, error: "no result" });
        continue;
      }

      // If the client supplied an anchor (the day's city coords) tell it how
      // far we landed from it. The client uses this to flag suspicious legs
      // in the UI without us dropping the result here.
      let anchorDistanceKm;
      if (isValidLatLng(item.anchorCoord)) {
        anchorDistanceKm = haversineKm(item.anchorCoord, { lat: hit.lat, lng: hit.lng });
      }

      results.push({
        id: item.id,
        lat: hit.lat,
        lng: hit.lng,
        displayName: hit.displayName,
        usedQuery,
        ...(anchorDistanceKm !== undefined ? { anchorDistanceKm } : {}),
      });
    }

    res.json({ items: results });
  } catch (err) {
    console.error("[maps/geocode]", err);
    res.status(500).json({ error: "Internal error", code: "INTERNAL" });
  }
}

/**
 * POST /api/maps/routes
 *   body: { legs: [{ fromId, toId, from: {lat,lng}, to: {lat,lng} }] }
 *   returns: {
 *     legs: [{
 *       fromId, toId,
 *       distanceKm?, durationMinutes?,
 *       geometry?: [[lng,lat], ...],
 *       estimated?: boolean,
 *       error?: string
 *     }]
 *   }
 */
export async function handleRoutesBatch(req, res) {
  try {
    const body = req.body || {};
    const legs = Array.isArray(body.legs) ? body.legs : [];

    // Sequential to keep the public OSRM demo happy; cache hits are instant.
    const out = [];
    for (const leg of legs) {
      if (!leg || !leg.from || !leg.to) {
        out.push({
          fromId: String(leg?.fromId ?? ""),
          toId: String(leg?.toId ?? ""),
          error: "missing endpoints",
        });
        continue;
      }
      const route = await getRouteFromCoords(leg.from, leg.to, { withGeometry: true });
      if (!route) {
        out.push({
          fromId: leg.fromId,
          toId: leg.toId,
          error: "no route",
        });
        continue;
      }
      out.push({
        fromId: leg.fromId,
        toId: leg.toId,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
        geometry: route.geometry || null,
        estimated: Boolean(route.estimated),
      });
    }

    res.json({ legs: out });
  } catch (err) {
    console.error("[maps/routes]", err);
    res.status(500).json({ error: "Internal error", code: "INTERNAL" });
  }
}

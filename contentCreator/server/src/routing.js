/**
 * OSRM routing helper.
 *
 * Given two place-name queries (previous stop, current stop), produce a
 * driving distance + duration estimate. Used by the LLM drivers to inject
 * an "X km, Y min from previous stop" header into the generated content.
 *
 * Backend strategy (mirrors 4. Map intilligent's /api/route fallback chain):
 *   1. Geocode both queries via geocode.js (Nominatim, cached).
 *   2. Call the public OSRM demo server (no API key).
 *   3. On any OSRM failure (network / 5xx / 429 / no route), fall back to
 *      Haversine great-circle distance times 1.4 with a 60 km/h estimate.
 *   4. If geocoding fails for either point, return `null`.
 *
 * All helpers are non-throwing: callers receive either a populated leg
 * object or `null` and gracefully omit the distance header in that case.
 */

import { geocode } from "./geocode.js";

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const FETCH_TIMEOUT_MS = 10000;
const CACHE_MAX = 500;
const AVG_DRIVING_KMH = 60;
const ROAD_FACTOR = 1.4;

const routeCache = new Map();

function cacheSet(key, value) {
  if (routeCache.size >= CACHE_MAX) {
    const firstKey = routeCache.keys().next().value;
    if (firstKey !== undefined) routeCache.delete(firstKey);
  }
  routeCache.set(key, value);
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

async function callOsrm(from, to) {
  const url =
    `${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&alternatives=false&steps=false`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      console.warn(`[routing] OSRM HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route || typeof route.distance !== "number") return null;
    return {
      distanceKm: route.distance / 1000,
      durationMinutes: route.duration / 60,
      source: "osrm",
    };
  } catch (err) {
    console.warn("[routing] OSRM error:", err?.message || err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function haversineEstimate(from, to) {
  const straight = haversineKm(from, to);
  const distanceKm = straight * ROAD_FACTOR;
  const durationMinutes = (distanceKm / AVG_DRIVING_KMH) * 60;
  return { distanceKm, durationMinutes, source: "haversine" };
}

/**
 * Get the driving route between two place-name queries.
 *
 * @param {string} prevQuery - Previous entity name or disambiguation query.
 * @param {string} currentQuery - Current entity name or disambiguation query.
 * @param {{ outputLanguage?: string }} [opts]
 * @returns {Promise<{
 *   distanceKm: number,
 *   durationMinutes: number,
 *   fromName: string,
 *   toName: string,
 *   source: "osrm" | "haversine",
 *   estimated: boolean,
 * } | null>}
 */
export async function getRouteBetween(prevQuery, currentQuery, opts = {}) {
  const prev = (prevQuery || "").trim();
  const curr = (currentQuery || "").trim();
  if (!prev || !curr) return null;
  if (prev.toLowerCase() === curr.toLowerCase()) return null;

  const from = await geocode(prev, opts);
  const to = await geocode(curr, opts);
  if (!from || !to) return null;

  const cacheKey = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  if (routeCache.has(cacheKey)) {
    const cached = routeCache.get(cacheKey);
    return {
      ...cached,
      fromName: prev,
      toName: curr,
    };
  }

  let outcome = await callOsrm(from, to);
  let estimated = false;
  if (!outcome) {
    outcome = haversineEstimate(from, to);
    estimated = true;
  } else if (outcome.distanceKm < 0.01) {
    // OSRM occasionally returns a zero-length route when the points snap to
    // the same node; trust the straight-line estimate in that case.
    outcome = haversineEstimate(from, to);
    estimated = true;
  }

  const result = {
    distanceKm: outcome.distanceKm,
    durationMinutes: outcome.durationMinutes,
    source: outcome.source,
    estimated,
  };
  cacheSet(cacheKey, result);
  return { ...result, fromName: prev, toName: curr };
}

/**
 * Format a leg into a localized, human-readable header line. Returns "" if
 * the leg is missing so callers can prepend unconditionally.
 */
export function formatLegHeader(leg, outputLanguage) {
  if (!leg) return "";
  const lang = (outputLanguage || "").toLowerCase();
  const km = leg.distanceKm < 10
    ? leg.distanceKm.toFixed(1)
    : Math.round(leg.distanceKm).toString();
  const totalMin = Math.max(1, Math.round(leg.durationMinutes));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  const approx = leg.estimated ? "~" : "";

  let timeStr;
  if (lang === "thai") {
    timeStr = hours > 0
      ? `${approx}${hours} ชั่วโมง${minutes > 0 ? ` ${minutes} นาที` : ""}`
      : `${approx}${totalMin} นาที`;
    return `**จากสถานที่ก่อนหน้า (${leg.fromName}):** ${approx}${km} กม · ขับรถประมาณ ${timeStr}`;
  }
  if (lang === "chinese") {
    timeStr = hours > 0
      ? `${approx}${hours}小时${minutes > 0 ? `${minutes}分钟` : ""}`
      : `${approx}${totalMin}分钟`;
    return `**从上一站(${leg.fromName})出发：** 约 ${km} 公里 · 驾车${timeStr}`;
  }
  timeStr = hours > 0
    ? `${approx}${hours} h${minutes > 0 ? ` ${minutes} min` : ""}`
    : `${approx}${totalMin} min`;
  return `**From previous stop (${leg.fromName}):** ${approx}${km} km · ${timeStr} by car`;
}

/**
 * Format the same leg as a compact, language-neutral fact suitable for
 * injection into the LLM prompt. Keeping it numeric avoids the model
 * paraphrasing the figures away.
 */
export function formatLegForPrompt(leg) {
  if (!leg) return "";
  const km = leg.distanceKm < 10
    ? leg.distanceKm.toFixed(1)
    : Math.round(leg.distanceKm).toString();
  const min = Math.max(1, Math.round(leg.durationMinutes));
  const approx = leg.estimated ? "approximate " : "";
  return `Distance from previous stop "${leg.fromName}" to "${leg.toName}": ${approx}${km} km, about ${min} minutes by car${leg.estimated ? " (straight-line estimate)" : ""}.`;
}

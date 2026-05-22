import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MlMap, Marker } from 'maplibre-gl';
import type { LatLng, RouteLegResult } from '../services/mapService';

export interface MapLocation {
    id: string;
    name: string;
    day?: string;
    lat: number;
    lng: number;
}

interface MapViewProps {
    locations: MapLocation[];
    routes: RouteLegResult[];
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    /** Total expected stop count, so we can show "X of N on map" status. */
    totalItems?: number;
}

const STYLES = {
    voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

// Stable, friendly palette cycled by day. Matches the slate UI well.
const DAY_PALETTE = [
    '#0ea5e9', // sky-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#d946ef', // fuchsia-500
    '#6366f1', // indigo-500
    '#f43f5e', // rose-500
    '#14b8a6', // teal-500
    '#f97316', // orange-500
];

function dayColor(day: string | undefined, dayIndexMap: Map<string, number>): string {
    const key = day || '__none__';
    if (!dayIndexMap.has(key)) {
        dayIndexMap.set(key, dayIndexMap.size);
    }
    const idx = dayIndexMap.get(key) || 0;
    return DAY_PALETTE[idx % DAY_PALETTE.length];
}

function makePinElement(
    label: string,
    color: string,
    selected: boolean,
    suspicious: boolean,
): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'cc-map-pin';
    el.style.width = '28px';
    el.style.height = '28px';
    el.style.borderRadius = '50%';
    el.style.background = color;
    el.style.color = '#fff';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.fontSize = '12px';
    el.style.fontWeight = '700';
    el.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    // Suspicious pins get a rose-500 ring so they pop visually; selected
    // (and not-suspicious) pins get the usual white border + day-colour halo.
    const borderColor = suspicious
        ? '#f43f5e' // rose-500
        : selected ? '#fff' : 'rgba(255,255,255,0.85)';
    el.style.border = `2px solid ${borderColor}`;
    el.style.boxShadow = selected
        ? `0 0 0 3px ${color}66, 0 2px 6px rgba(0,0,0,0.45)`
        : suspicious
            ? '0 0 0 2px rgba(244,63,94,0.35), 0 2px 4px rgba(0,0,0,0.35)'
            : '0 2px 4px rgba(0,0,0,0.35)';
    el.style.transform = selected ? 'scale(1.12)' : 'scale(1)';
    el.style.transition = 'transform 120ms ease, box-shadow 120ms ease';
    el.style.cursor = 'pointer';
    el.style.position = 'relative';
    el.textContent = label;
    if (suspicious) {
        // Small "?" badge in the top-right corner. Helps the user spot which
        // pins to consider removing via the sidebar ✕ button.
        const badge = document.createElement('span');
        badge.textContent = '?';
        badge.style.position = 'absolute';
        badge.style.top = '-6px';
        badge.style.right = '-6px';
        badge.style.width = '14px';
        badge.style.height = '14px';
        badge.style.borderRadius = '50%';
        badge.style.background = '#f43f5e';
        badge.style.color = '#fff';
        badge.style.fontSize = '10px';
        badge.style.fontWeight = '700';
        badge.style.lineHeight = '14px';
        badge.style.textAlign = 'center';
        badge.style.boxShadow = '0 1px 2px rgba(0,0,0,0.4)';
        el.appendChild(badge);
    }
    return el;
}

export const MapView: React.FC<MapViewProps> = ({
    locations,
    routes,
    selectedId,
    onSelect,
    totalItems,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MlMap | null>(null);
    const markersRef = useRef<Map<string, Marker>>(new Map());
    const styleReadyRef = useRef(false);
    const [styleKey, setStyleKey] = useState<keyof typeof STYLES>('voyager');

    // Day -> color mapping, stable across renders for a given location list.
    const colorByDay = useMemo(() => {
        const m = new Map<string, number>();
        // Walk in itinerary order so day-1 always gets the first colour, etc.
        for (const loc of locations) {
            const k = loc.day || '__none__';
            if (!m.has(k)) m.set(k, m.size);
        }
        return m;
    }, [locations]);

    // An item id is suspicious if any leg touching it carries the flag.
    // Derived from `routes` so callers don't need to plumb a separate prop.
    const suspiciousIds = useMemo(() => {
        const s = new Set<string>();
        for (const r of routes) {
            if (!r.suspicious) continue;
            s.add(r.fromId);
            s.add(r.toId);
        }
        return s;
    }, [routes]);

    // Per-day numbering for the pin label (1, 2, 3 within each day).
    const labelByLocId = useMemo(() => {
        const counts = new Map<string, number>();
        const result = new Map<string, number>();
        for (const loc of locations) {
            const key = loc.day || '__none__';
            const next = (counts.get(key) || 0) + 1;
            counts.set(key, next);
            result.set(loc.id, next);
        }
        return result;
    }, [locations]);

    // --- Map init ---
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: STYLES[styleKey],
            center: [0, 20],
            zoom: 1.5,
            attributionControl: { compact: true },
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
        map.on('load', () => {
            styleReadyRef.current = true;
        });
        map.on('styledata', () => {
            // styledata fires every time a new style finishes loading too.
            styleReadyRef.current = true;
        });
        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            markersRef.current.clear();
            styleReadyRef.current = false;
        };
        // intentionally empty: we manage style changes via setStyle below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Switch base style without recreating the map ---
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        styleReadyRef.current = false;
        map.setStyle(STYLES[styleKey]);
    }, [styleKey]);

    // --- Render markers ---
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const stale = new Set(markersRef.current.keys());
        for (const loc of locations) {
            stale.delete(loc.id);
            const color = DAY_PALETTE[(colorByDay.get(loc.day || '__none__') || 0) % DAY_PALETTE.length];
            const label = String(labelByLocId.get(loc.id) || '');
            const isSelected = selectedId === loc.id;
            const isSuspicious = suspiciousIds.has(loc.id);

            const existing = markersRef.current.get(loc.id);
            if (existing) {
                existing.setLngLat([loc.lng, loc.lat]);
                const newEl = makePinElement(label, color, isSelected, isSuspicious);
                newEl.addEventListener('click', () => onSelect?.(loc.id));
                const oldEl = existing.getElement();
                oldEl.replaceWith(newEl);
                (existing as unknown as { _element: HTMLElement })._element = newEl;
                continue;
            }

            const el = makePinElement(label, color, isSelected, isSuspicious);
            el.addEventListener('click', () => onSelect?.(loc.id));
            const m = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([loc.lng, loc.lat])
                .addTo(map);
            markersRef.current.set(loc.id, m);
        }
        for (const goneId of stale) {
            const m = markersRef.current.get(goneId);
            if (m) {
                m.remove();
                markersRef.current.delete(goneId);
            }
        }
    }, [locations, selectedId, colorByDay, labelByLocId, onSelect, suspiciousIds]);

    // --- Render route polylines as a GeoJSON source/layer ---
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const SOURCE_ID = 'cc-route-lines';
        const LAYER_SOLID = 'cc-route-lines-solid';
        const LAYER_DASHED = 'cc-route-lines-dashed';
        const LABEL_SOURCE_ID = 'cc-route-labels';
        const LABEL_LAYER_ID = 'cc-route-labels-layer';

        const formatDistance = (km: number) =>
            km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
        const formatDuration = (min: number) => {
            const m = Math.max(1, Math.round(min));
            if (m < 60) return m + ' min';
            const h = Math.floor(m / 60);
            const rest = m % 60;
            return rest > 0 ? `${h}h ${rest}m` : `${h}h`;
        };
        const midpointOf = (coords: [number, number][]) => {
            // Pick a coordinate near the middle of the polyline (in array
            // order, not arc length — good enough for a label).
            return coords[Math.floor(coords.length / 2)];
        };

        const apply = () => {
            const features = routes
                .filter(r => Array.isArray(r.geometry) && r.geometry.length >= 2)
                .map(r => {
                    const dayKey = r.day || '__none__';
                    const colorIdx = colorByDay.get(dayKey) || 0;
                    const suspicious = Boolean(r.suspicious);
                    return {
                        type: 'Feature' as const,
                        properties: {
                            // Suspicious legs override the palette colour
                            // with rose-500 so they pop visually, and ride
                            // the dashed layer alongside Haversine fallbacks.
                            color: suspicious ? '#f43f5e' : DAY_PALETTE[colorIdx % DAY_PALETTE.length],
                            estimated: Boolean(r.estimated) || suspicious,
                            suspicious,
                        },
                        geometry: {
                            type: 'LineString' as const,
                            coordinates: r.geometry as [number, number][],
                        },
                    };
                });
            const collection = { type: 'FeatureCollection' as const, features };

            // Label features: a Point at each line's midpoint carrying a
            // "X km · Y min" string so the user sees the leg cost on the map.
            const labelFeatures = routes
                .filter(r => Array.isArray(r.geometry) && r.geometry.length >= 2
                    && typeof r.distanceKm === 'number'
                    && typeof r.durationMinutes === 'number')
                .map(r => {
                    const dayKey = r.day || '__none__';
                    const colorIdx = colorByDay.get(dayKey) || 0;
                    const suspicious = Boolean(r.suspicious);
                    const base = `${formatDistance(r.distanceKm as number)} · ${formatDuration(r.durationMinutes as number)}`;
                    return {
                        type: 'Feature' as const,
                        properties: {
                            color: suspicious ? '#9f1239' /* rose-800 */ : DAY_PALETTE[colorIdx % DAY_PALETTE.length],
                            label: suspicious ? `? ${base}` : base,
                            suspicious,
                        },
                        geometry: {
                            type: 'Point' as const,
                            coordinates: midpointOf(r.geometry as [number, number][]),
                        },
                    };
                });
            const labelCollection = {
                type: 'FeatureCollection' as const,
                features: labelFeatures,
            };

            const existingLineSrc = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
            if (existingLineSrc) {
                existingLineSrc.setData(collection);
            } else {
                map.addSource(SOURCE_ID, { type: 'geojson', data: collection });
                // Two line layers split by `estimated` because MapLibre's
                // line-dasharray doesn't accept data-driven expressions — a
                // single layer with a case expression silently fails to add.
                map.addLayer({
                    id: LAYER_SOLID,
                    type: 'line',
                    source: SOURCE_ID,
                    filter: ['!=', ['get', 'estimated'], true],
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': ['get', 'color'],
                        'line-width': 4,
                        'line-opacity': 0.85,
                    },
                });
                map.addLayer({
                    id: LAYER_DASHED,
                    type: 'line',
                    source: SOURCE_ID,
                    filter: ['==', ['get', 'estimated'], true],
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': ['get', 'color'],
                        'line-width': 3,
                        'line-opacity': 0.75,
                        'line-dasharray': [2, 2],
                    },
                });
            }

            const existingLabelSrc = map.getSource(LABEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
            if (existingLabelSrc) {
                existingLabelSrc.setData(labelCollection);
            } else {
                map.addSource(LABEL_SOURCE_ID, { type: 'geojson', data: labelCollection });
                map.addLayer({
                    id: LABEL_LAYER_ID,
                    type: 'symbol',
                    source: LABEL_SOURCE_ID,
                    layout: {
                        'text-field': ['get', 'label'],
                        'text-size': 12,
                        // Both CARTO Voyager and Dark Matter ship Open Sans
                        // Regular as their default glyph PBFs.
                        'text-font': ['Open Sans Regular'],
                        'text-anchor': 'center',
                        'text-justify': 'center',
                        'text-padding': 2,
                        'text-allow-overlap': true,
                        'text-ignore-placement': true,
                        'symbol-placement': 'point',
                    },
                    paint: {
                        // Default slate for normal legs, rose for suspicious.
                        'text-color': ['coalesce', ['get', 'color'], '#0f172a'],
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 1.5,
                        'text-halo-blur': 0.4,
                    },
                });
            }
        };

        if (styleReadyRef.current && map.isStyleLoaded()) {
            apply();
        } else {
            const handler = () => {
                if (map.isStyleLoaded()) {
                    apply();
                    map.off('styledata', handler);
                }
            };
            map.on('styledata', handler);
            return () => {
                map.off('styledata', handler);
            };
        }
    }, [routes, colorByDay, styleKey]);

    // --- Fit bounds when locations change ---
    useEffect(() => {
        const map = mapRef.current;
        if (!map || locations.length === 0) return;
        if (locations.length === 1) {
            map.easeTo({ center: [locations[0].lng, locations[0].lat], zoom: 11, duration: 600 });
            return;
        }
        const bounds = new maplibregl.LngLatBounds();
        for (const loc of locations) bounds.extend([loc.lng, loc.lat]);
        try {
            map.fitBounds(bounds, { padding: 56, duration: 600, maxZoom: 12 });
        } catch {
            /* bounds may be empty if all locations coincide; ignore. */
        }
    }, [locations]);

    // --- When the user selects an item elsewhere, pan to its pin ---
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !selectedId) return;
        const target = locations.find(l => l.id === selectedId);
        if (!target) return;
        map.easeTo({ center: [target.lng, target.lat], duration: 400 });
    }, [selectedId, locations]);

    const onMapCount = locations.length;
    const total = typeof totalItems === 'number' ? totalItems : onMapCount;

    return (
        <div className="relative w-full h-full">
            <div ref={containerRef} className="absolute inset-0 rounded-md overflow-hidden" />

            <div className="absolute top-2 left-2 z-10 bg-slate-900/80 border border-slate-700 text-slate-200 text-xs px-2 py-1 rounded-md backdrop-blur">
                {onMapCount} of {total} stops on map
            </div>

            <div className="absolute top-2 right-12 z-10 bg-slate-900/80 border border-slate-700 rounded-md backdrop-blur flex text-xs overflow-hidden">
                <button
                    type="button"
                    onClick={() => setStyleKey('voyager')}
                    className={`px-2 py-1 transition-colors ${styleKey === 'voyager' ? 'bg-cyan-700 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                    Voyager
                </button>
                <button
                    type="button"
                    onClick={() => setStyleKey('dark')}
                    className={`px-2 py-1 transition-colors ${styleKey === 'dark' ? 'bg-cyan-700 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                    Dark
                </button>
            </div>

            {onMapCount === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-slate-900/80 border border-slate-700 text-slate-300 text-sm px-4 py-2 rounded-md">
                        No coordinates available yet. The map fills in as locations are geocoded.
                    </div>
                </div>
            )}
        </div>
    );
};

"use client";

import { useJsApiLoader } from "@react-google-maps/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView";
import SourceManager from "./SourceManager";
import DestinationPicker from "./DestinationPicker";
import RouteResultsPanel from "./RouteResultsPanel";
import { decodePolyline } from "@/lib/geoUtils";
import {
  clearSavedCorridors,
  corridorForDistrict,
  DEFAULT_CORRIDORS,
  getCorridor,
  loadCorridors,
  saveCorridors,
  type Corridor,
} from "@/lib/corridors";
import type {
  DestinationPoint,
  LatLng,
  RouteResult,
  SourceLocation,
} from "@/lib/types";

const LIBRARIES: "places"[] = ["places"];

// Stable references so <MapView> effects don't re-run on every render.
const NO_PATH: LatLng[] = [];
const NO_TOLLS: RouteResult["tollPlazas"] = [];
const NO_WAYPOINTS: { name: string; position: LatLng }[] = [];

// Place types we treat as "a town / taluka / district", best first.
const PLACE_TYPES = [
  "locality",
  "administrative_area_level_3",
  "administrative_area_level_2",
];

interface ResolvedPlace {
  name: string;
  position: LatLng;
  address?: string;
  district?: string;
}

function districtOf(
  components?: { long_name: string; types: string[] }[]
): string | undefined {
  return components?.find((c) => c.types.includes("administrative_area_level_2"))
    ?.long_name;
}

/**
 * Turn a raw map click into a named place.
 *
 * - Clicking a map label gives us a `placeId`; if it *is* a town/district we
 *   use it directly, otherwise we take its location and look up the town
 *   containing it (so clicking a hotel still yields "Phaltan").
 * - `position` is the town's own centre where we can determine it, not the
 *   arbitrary point under the cursor - routing from a town centre is what we
 *   actually want.
 * - `district` (admin level 2) drives the default corridor.
 */
async function resolvePlace(
  clicked: LatLng,
  placeId?: string
): Promise<ResolvedPlace> {
  const fallback: ResolvedPlace = {
    name: `${clicked.lat.toFixed(3)}, ${clicked.lng.toFixed(3)}`,
    position: clicked,
  };

  let origin = clicked;

  if (placeId) {
    try {
      const service = new google.maps.places.PlacesService(
        document.createElement("div")
      );
      const place = await new Promise<google.maps.places.PlaceResult>(
        (resolve, reject) =>
          service.getDetails(
            {
              placeId,
              fields: [
                "name",
                "types",
                "geometry",
                "formatted_address",
                "address_components",
              ],
            },
            (p, status) =>
              status === google.maps.places.PlacesServiceStatus.OK && p
                ? resolve(p)
                : reject(status)
          )
      );
      const loc = place.geometry?.location;
      if (loc) {
        origin = { lat: loc.lat(), lng: loc.lng() };
        const district = districtOf(
          place.address_components as { long_name: string; types: string[] }[]
        );
        // A locality / admin area label - exactly what we want, use it as-is.
        if (place.types?.some((t) => PLACE_TYPES.includes(t))) {
          return {
            name: place.name ?? fallback.name,
            position: origin,
            address: place.formatted_address,
            district,
          };
        }
        // A business/POI - fall through and resolve the town around it.
      }
    } catch (e) {
      console.warn("Place details failed:", e);
    }
  }

  try {
    const { results } = await new google.maps.Geocoder().geocode({
      location: origin,
    });
    const district = results
      ?.map((r) => districtOf(r.address_components))
      .find(Boolean);

    // Prefer a result that *is* a town/taluka/district: its geometry is that
    // place's centre, so we can snap to it.
    for (const type of PLACE_TYPES) {
      const whole = results?.find((r) => r.types.includes(type));
      if (whole) {
        const comp = whole.address_components.find((c) =>
          c.types.includes(type)
        );
        const loc = whole.geometry.location;
        return {
          name: comp?.long_name ?? whole.formatted_address,
          position: { lat: loc.lat(), lng: loc.lng() },
          address: whole.formatted_address,
          district,
        };
      }
    }

    for (const type of PLACE_TYPES) {
      for (const r of results ?? []) {
        const c = r.address_components.find((comp) => comp.types.includes(type));
        if (c) {
          return {
            name: c.long_name,
            position: origin,
            address: r.formatted_address,
            district,
          };
        }
      }
    }

    if (results?.[0]) {
      return {
        name: results[0].formatted_address,
        position: origin,
        address: results[0].formatted_address,
        district,
      };
    }
  } catch (e) {
    // Most common cause: Geocoding API not enabled / not allowed for the
    // browser key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
    console.warn("Reverse geocode failed:", e);
  }

  return { ...fallback, position: origin };
}

function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(0)} km`;
}

function formatMinutes(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

async function safeJson(p: Promise<Response>): Promise<any> {
  try {
    return await (await p).json();
  } catch {
    return {};
  }
}

// Pre-filled gathering point; the user can still clear or change it.
const DEFAULT_DESTINATION: DestinationPoint = {
  name: "Dhavadwadi",
  position: { lat: 17.1196387, lng: 75.0720799 },
  formattedAddress: "Dhavadwadi, Jat, Sangli, Maharashtra, India",
};

export default function MapDashboard() {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    libraries: LIBRARIES,
  });

  const [sources, setSources] = useState<SourceLocation[]>([]);
  const [destination, setDestination] = useState<DestinationPoint | null>(
    DEFAULT_DESTINATION
  );
  const [addSourceMode, setAddSourceMode] = useState(false);

  // Corridor waypoints are draggable, so they live in state and persist.
  // Seeded with the defaults so server and first client render match; the
  // saved set is pulled in on mount.
  const [corridors, setCorridors] = useState<Corridor[]>(DEFAULT_CORRIDORS);
  useEffect(() => setCorridors(loadCorridors()), []);

  // The one source whose animated route to the gathering point is on screen.
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // True while a map click is being turned into a named place.
  const [resolving, setResolving] = useState(false);

  // Mobile only: the sidebar renders as a collapsible sheet over the
  // full-bleed map (see the max-width:860px rules in dashboard.css). Starts
  // collapsed so the map is what you see first, like the Google Maps app;
  // opens itself whenever there's something worth showing.
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Bumped on every input change. An in-flight calculation whose id no longer
  // matches is stale (its source/destination/corridor changed since) and must
  // not write its result back to the map.
  const routeGen = useRef(0);

  const clearRoute = useCallback(() => {
    routeGen.current++;
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  const runRouteWithCorridor = useCallback(
    async (
      source: SourceLocation,
      dest: DestinationPoint,
      corridor: Corridor
    ) => {
      const gen = ++routeGen.current;
      const isCurrent = () => routeGen.current === gen;

      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const routeRes = await fetch("/api/route-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: source.position,
            destination: dest.position,
            waypoints: corridor.waypoints.map((w) => w.position),
          }),
        });
        const routeData = await routeRes.json();
        if (!routeRes.ok) {
          throw new Error(routeData.error ?? "Failed to fetch route.");
        }
        if (!isCurrent()) return;

        // Show the route straight away; tehsils/tolls are enrichment.
        setResult({
          source,
          destination: dest,
          corridorId: corridor.id,
          distanceMeters: routeData.distanceMeters,
          durationSeconds: routeData.durationSeconds,
          encodedPolyline: routeData.encodedPolyline,
          path: decodePolyline(routeData.encodedPolyline),
          legs: routeData.legs,
          tollInfo: routeData.tollInfo,
          tehsils: [],
          tollPlazas: [],
          enriching: true,
        });
        setLoading(false);

        const [tehsilData, tollData] = await Promise.all([
          safeJson(
            fetch("/api/tehsils-along-route", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                encodedPolyline: routeData.encodedPolyline,
              }),
            })
          ),
          safeJson(
            fetch("/api/toll-plazas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                encodedPolyline: routeData.encodedPolyline,
              }),
            })
          ),
        ]);
        if (!isCurrent()) return;

        setResult((prev) =>
          prev && prev.source.id === source.id
            ? {
                ...prev,
                tehsils: tehsilData.tehsils ?? [],
                tollPlazas: tollData.tollPlazas ?? [],
                tollInfo: tollData.tollTotal
                  ? { estimatedPrice: tollData.tollTotal }
                  : prev.tollInfo,
                tollNote: tollData.warning,
                enriching: false,
              }
            : prev
        );
      } catch (e) {
        if (!isCurrent()) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setLoading(false);
      }
    },
    []
  );

  const runRouteForSource = useCallback(
    (source: SourceLocation, dest: DestinationPoint) =>
      runRouteWithCorridor(
        source,
        dest,
        getCorridor(corridors, source.corridorId)
      ),
    [corridors, runRouteWithCorridor]
  );

  const handleSelectSource = useCallback(
    (id: string) => {
      setSheetExpanded(true);
      setSelectedSourceId(id);
      const source = sources.find((s) => s.id === id);
      if (source && destination) runRouteForSource(source, destination);
      else clearRoute();
    },
    [sources, destination, runRouteForSource, clearRoute]
  );

  const handleAddSource = (source: SourceLocation) => {
    setSheetExpanded(true);
    const withCorridor: SourceLocation = {
      ...source,
      corridorId: source.corridorId ?? corridorForDistrict(source.district),
    };
    setSources((prev) => [...prev, withCorridor]);
    setAddSourceMode(false);
    setSelectedSourceId(withCorridor.id);
    if (destination) runRouteForSource(withCorridor, destination);
    else clearRoute();
  };

  const handleRemoveSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    if (selectedSourceId === id) {
      setSelectedSourceId(null);
      clearRoute();
    }
  };

  const handleSetCorridor = (id: string, corridorId: string) => {
    const current = sources.find((s) => s.id === id);
    if (!current) return;
    const next = { ...current, corridorId };
    setSources((prev) => prev.map((s) => (s.id === id ? next : s)));
    if (selectedSourceId === id && destination) {
      runRouteForSource(next, destination);
    }
  };

  // Dragging a corridor waypoint on the map: nudge it onto the road you want
  // (a bypass rather than a town centre) and re-run the traced route.
  const handleMoveWaypoint = (
    corridorId: string,
    index: number,
    position: LatLng
  ) => {
    const next = corridors.map((c) =>
      c.id === corridorId
        ? {
            ...c,
            waypoints: c.waypoints.map((w, i) =>
              i === index ? { ...w, position } : w
            ),
          }
        : c
    );
    setCorridors(next);
    saveCorridors(next);

    const source = sources.find((s) => s.id === selectedSourceId);
    if (source && destination && (source.corridorId ?? "direct") === corridorId) {
      // runRouteForSource still closes over the old corridors, so resolve the
      // updated waypoints here.
      const corridor = getCorridor(next, corridorId);
      runRouteWithCorridor(source, destination, corridor);
    }
  };

  const handleResetCorridors = () => {
    clearSavedCorridors();
    setCorridors(DEFAULT_CORRIDORS);
    const source = sources.find((s) => s.id === selectedSourceId);
    if (source && destination) {
      runRouteWithCorridor(
        source,
        destination,
        getCorridor(DEFAULT_CORRIDORS, source.corridorId)
      );
    }
  };

  const handleSelectDestination = (dest: DestinationPoint) => {
    setSheetExpanded(true);
    setDestination(dest);
    const source = sources.find((s) => s.id === selectedSourceId);
    if (source) runRouteForSource(source, dest);
    else clearRoute();
  };

  const handleClearDestination = () => {
    setDestination(null);
    clearRoute();
  };

  const handleMapClick = async (clicked: LatLng, placeId?: string) => {
    setResolving(true);
    let place: ResolvedPlace;
    try {
      place = await resolvePlace(clicked, placeId);
    } finally {
      setResolving(false);
    }

    if (addSourceMode) {
      handleAddSource({
        id: crypto.randomUUID(),
        name: place.name,
        position: place.position,
        district: place.district,
      });
      return;
    }

    handleSelectDestination({
      name: place.name,
      position: place.position,
      formattedAddress: place.address ?? place.name,
    });
  };

  const tracedSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) ?? null,
    [sources, selectedSourceId]
  );
  const tracedCorridor = getCorridor(corridors, tracedSource?.corridorId);

  // One line for the mobile peek bar - what you'd see before expanding it.
  const sheetSummary = error
    ? error
    : loading
    ? "Calculating route…"
    : result
    ? `${result.source.name} → ${result.destination.name} · ${formatKm(
        result.distanceMeters
      )} · ${formatMinutes(result.durationSeconds)}`
    : sources.length === 0
    ? "Tap the map to add a source"
    : !destination
    ? `${sources.length} source${sources.length === 1 ? "" : "s"} · set a gathering point`
    : `${sources.length} source${sources.length === 1 ? "" : "s"} · tap one to trace its route`;

  if (!isLoaded) {
    return <div className="loadingScreen">Loading map…</div>;
  }

  return (
    <div className="dashboard">
      <aside
        className={`sidebar scrollbar ${
          sheetExpanded ? "sheetExpanded" : "sheetCollapsed"
        }`}
      >
        <button
          className="sheetHandle"
          onClick={() => setSheetExpanded((v) => !v)}
          aria-expanded={sheetExpanded}
        >
          <span className="sheetGrip" />
          <span className="sheetSummary">{sheetSummary}</span>
          <span className="sheetChevron">{sheetExpanded ? "⌄" : "⌃"}</span>
        </button>

        <div className="brand">
          <h1>District Router</h1>
          <p className="muted">
            Drop the cities / districts people travel from, then click a source
            to trace its route to the gathering point.
          </p>
        </div>

        <SourceManager
          sources={sources}
          corridors={corridors}
          selectedSourceId={selectedSourceId}
          addSourceMode={addSourceMode}
          onToggleAddMode={() => setAddSourceMode((v) => !v)}
          onAddSource={handleAddSource}
          onRemoveSource={handleRemoveSource}
          onSelectSource={handleSelectSource}
          onSetCorridor={handleSetCorridor}
        />

        <section>
          <div className="sectionHeader">
            <h2>Corridors</h2>
            <button className="pillButton" onClick={handleResetCorridors}>
              Reset waypoints
            </button>
          </div>
          <ul className="corridorLegend">
            {corridors.map((c) => (
              <li key={c.id}>
                <span
                  className="corridorSwatch"
                  style={{ background: c.color }}
                />
                <span>
                  <strong>{c.short}</strong>
                  <span className="muted"> — {c.label}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="hint">
            Each source gets a corridor from its district; override it per source
            above. Drag a diamond on the map to move a waypoint onto the road you
            want used — a bypass rather than a town centre.
          </p>
        </section>

        <DestinationPicker
          destination={destination}
          onSelect={handleSelectDestination}
          onClear={handleClearDestination}
        />

        <RouteResultsPanel
          loading={loading}
          error={error}
          result={result}
          corridors={corridors}
        />
      </aside>

      <main className="mapArea">
        {resolving && <div className="mapToast">Finding place…</div>}

        {/* Mobile only (hidden on desktop by CSS): quick access to the two
            actions you'd otherwise have to open the sheet for. */}
        <button
          className={`mapFab mapFabAdd ${addSourceMode ? "mapFabActive" : ""}`}
          onClick={() => setAddSourceMode((v) => !v)}
          aria-label={addSourceMode ? "Cancel adding a source" : "Add a source"}
          title={addSourceMode ? "Tap the map to place it" : "Add a source"}
        >
          {addSourceMode ? "×" : "+"}
        </button>
        {!sheetExpanded && (
          <button
            className="mapFab mapFabSheet"
            onClick={() => setSheetExpanded(true)}
            aria-label="Open route panel"
            title="Open route panel"
          >
            ☰
          </button>
        )}

        <MapView
          sources={sources}
          selectedSourceId={selectedSourceId}
          destination={destination}
          routePath={result?.path ?? NO_PATH}
          tollPlazas={result?.tollPlazas ?? NO_TOLLS}
          corridorWaypoints={tracedSource ? tracedCorridor.waypoints : NO_WAYPOINTS}
          corridorColor={tracedCorridor.color}
          onMoveWaypoint={(index, position) =>
            handleMoveWaypoint(tracedCorridor.id, index, position)
          }
          onMapClick={handleMapClick}
          onSelectSource={handleSelectSource}
        />
      </main>
    </div>
  );
}

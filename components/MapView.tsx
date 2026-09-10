"use client";

import { GoogleMap, Marker, useGoogleMap } from "@react-google-maps/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DestinationPoint,
  LatLng,
  SourceLocation,
  TollPlaza,
} from "@/lib/types";

// Default view: Satara, Maharashtra.
const DEFAULT_CENTER: LatLng = { lat: 17.6805, lng: 74.0183 };
const DEFAULT_ZOOM = 11;

const containerStyle = { width: "100%", height: "100%" };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  // Makes place labels/POIs clickable so a click can report a placeId, which
  // lets us snap to that town instead of the raw lat/lng.
  clickableIcons: true,
  // "hybrid" = satellite imagery with road/place labels; use "satellite" for imagery only.
  mapTypeId: "hybrid",
  // Note: custom `styles` below are ignored while a satellite/hybrid map type is active.
  styles: [
    { elementType: "geometry", stylers: [{ color: "#161d26" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#8ca0b3" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#10151c" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#26313d" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#324156" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d1620" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#2a3542" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ],
};

// Route styling: a slim solid line (white casing + blue core) with soft dots
// that drift along it toward the gathering point.
const ROUTE_CASING_OPTIONS: google.maps.PolylineOptions = {
  strokeColor: "#0f1b2d",
  strokeOpacity: 0.55,
  strokeWeight: 7,
  zIndex: 1,
};

const ROUTE_CORE_OPTIONS: google.maps.PolylineOptions = {
  strokeColor: "#4c9dff",
  strokeOpacity: 1,
  strokeWeight: 3.5,
  zIndex: 2,
};

const FLOW_DOT_SPACING_PX = 46; // gap between dots
const FLOW_SPEED_PX_PER_SEC = 34; // drift speed - lower is calmer

/**
 * The route from a source to the gathering point: a clean solid line with dots
 * drifting along it. Drawn imperatively (not via <Polyline>) so cleanup
 * reliably removes it when the selected source changes or is removed - the
 * wrapper component can leak orphaned polylines otherwise. Motion is
 * time-based on requestAnimationFrame so it stays smooth regardless of frame
 * rate.
 */
function AnimatedRoute({ path }: { path: LatLng[] }) {
  const map = useGoogleMap();

  useEffect(() => {
    if (!map || path.length < 2) return;

    // Built here, not at module scope: `google` only exists after the Maps
    // script has loaded.
    const flowDot: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 2.6,
      fillColor: "#eaf3ff",
      fillOpacity: 1,
      strokeColor: "#eaf3ff",
      strokeOpacity: 0.35,
      strokeWeight: 3,
    };

    const casing = new google.maps.Polyline({
      ...ROUTE_CASING_OPTIONS,
      path,
      map,
    });
    const core = new google.maps.Polyline({ ...ROUTE_CORE_OPTIONS, path, map });
    const flow = new google.maps.Polyline({
      path,
      map,
      strokeOpacity: 0,
      zIndex: 3,
      icons: [{ icon: flowDot, offset: "0px", repeat: `${FLOW_DOT_SPACING_PX}px` }],
    });

    let raf = 0;
    let last = performance.now();
    let pos = 0;
    const step = (now: number) => {
      pos =
        (pos + ((now - last) / 1000) * FLOW_SPEED_PX_PER_SEC) %
        FLOW_DOT_SPACING_PX;
      last = now;
      const icons = flow.get("icons") as google.maps.IconSequence[];
      icons[0].offset = `${pos}px`;
      flow.set("icons", icons);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      casing.setMap(null);
      core.setMap(null);
      flow.setMap(null);
    };
  }, [map, path]);

  return null;
}

interface Props {
  sources: SourceLocation[];
  selectedSourceId: string | null;
  destination: DestinationPoint | null;
  routePath: LatLng[];
  tollPlazas: TollPlaza[];
  /** Forced intermediate stops for the traced source's corridor. */
  corridorWaypoints: { name: string; position: LatLng }[];
  corridorColor: string;
  /** Drag a waypoint onto the road you want the corridor to use. */
  onMoveWaypoint: (index: number, position: LatLng) => void;
  /** `placeId` is present when the click landed on a map label / POI. */
  onMapClick: (position: LatLng, placeId?: string) => void;
  onSelectSource: (id: string) => void;
}

export default function MapView({
  sources,
  selectedSourceId,
  destination,
  routePath,
  tollPlazas,
  corridorWaypoints,
  corridorColor,
  onMoveWaypoint,
  onMapClick,
  onSelectSource,
}: Props) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);
    // If the container got its real size only after the map initialized
    // (common on mobile / after a layout shift), make it remeasure.
    setTimeout(() => {
      google.maps.event.trigger(map, "resize");
      const c = map.getCenter();
      if (c) map.setCenter(c);
    }, 60);
  }, []);

  // Read inside the fit effect without making it a trigger: the route and the
  // corridor waypoints change while you drag a waypoint, and refitting then
  // would yank the map away mid-tune.
  const latest = useRef({ routePath, corridorWaypoints });
  latest.current = { routePath, corridorWaypoints };

  // Frame the relevant points when the *selection* changes:
  // - a selected source + gathering point -> fit those two (and the corridor)
  // - otherwise -> fit every source pin (and the gathering point)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const { routePath, corridorWaypoints } = latest.current;
    const selected = sources.find((s) => s.id === selectedSourceId);
    const via = corridorWaypoints.map((w) => w.position);
    const points: LatLng[] =
      selected && destination
        ? [selected.position, destination.position, ...via, ...routePath]
        : selected
        ? [selected.position, ...via]
        : [
            ...sources.map((s) => s.position),
            ...(destination ? [destination.position] : []),
          ];

    if (points.length === 0) return;

    if (points.length === 1) {
      map.panTo(points[0]);
      map.setZoom(11);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 80);

    // fitBounds can over-zoom when the points are close together.
    const capListener = google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 14) map.setZoom(14);
    });
    return () => google.maps.event.removeListener(capListener);
  }, [mapReady, sources, destination, selectedSourceId]);

  const handleClick = useCallback(
    (e: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
      if (!e.latLng) return;
      const placeId = (e as google.maps.IconMouseEvent).placeId;
      // Clicking a label would otherwise pop Google's own info window.
      if (placeId) e.stop();
      onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() }, placeId ?? undefined);
    },
    [onMapClick]
  );

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      mapContainerClassName="mapCanvas"
      // Initial view only - constants, so the library applies them once and
      // then the fitBounds effect / user panning stays in control.
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      options={mapOptions}
      onLoad={onLoad}
      onClick={handleClick}
    >
      {sources.map((s) => {
        const active = s.id === selectedSourceId;
        return (
          <Marker
            key={s.id}
            position={s.position}
            title={s.name}
            onClick={() => onSelectSource(s.id)}
            zIndex={active ? 5 : 3}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: active ? 9 : 6,
              fillColor: active ? "#4fd1c5" : "#5b8c94",
              fillOpacity: 1,
              strokeColor: active ? "#e7ecf2" : "#10151c",
              strokeWeight: active ? 3 : 2,
            }}
          />
        );
      })}

      {corridorWaypoints.map((w, i) => (
        <Marker
          key={`wp-${i}-${w.name}`}
          position={w.position}
          title={`${w.name} — drag onto the road this corridor should use`}
          zIndex={4}
          draggable
          onDragEnd={(e) =>
            e.latLng &&
            onMoveWaypoint(i, { lat: e.latLng.lat(), lng: e.latLng.lng() })
          }
          icon={{
            // Diamond.
            path: "M 0,-1 1,0 0,1 -1,0 z",
            scale: 8,
            fillColor: corridorColor,
            fillOpacity: 1,
            strokeColor: "#10151c",
            strokeWeight: 2,
          }}
        />
      ))}

      {destination && (
        <Marker
          position={destination.position}
          title={destination.name}
          icon={{
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 6,
            rotation: 180,
            fillColor: "#ff5470",
            fillOpacity: 1,
            strokeColor: "#10151c",
            strokeWeight: 2,
          }}
        />
      )}

      {tollPlazas.map((t, i) => (
        <Marker
          key={`${t.position.lat}-${t.position.lng}-${i}`}
          position={t.position}
          title={
            t.tagCost ?? t.cashCost
              ? `${t.name} — ${t.currency ?? "INR"} ${Math.round(
                  (t.tagCost ?? t.cashCost)!
                )}`
              : t.name
          }
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: "#ffd166",
            fillOpacity: 1,
            strokeColor: "#10151c",
            strokeWeight: 1.5,
          }}
        />
      ))}

      {routePath.length > 1 && <AnimatedRoute path={routePath} />}
    </GoogleMap>
  );
}

import { NextRequest, NextResponse } from "next/server";
import type { LatLng } from "@/lib/types";
import {guard } from "@/lib/apiGuard";


/**
 * POST { origin: LatLng, destination: LatLng, waypoints?: LatLng[] }
 *
 * `waypoints` are forced intermediate stops - used by the "route via Phaltan"
 * toggle so every source's path is made to pass through that town.
 *
 * Calls the Routes API (the newer replacement for the legacy Directions
 * API) because it's the one that can also return an estimated toll cost.
 * Docs move fast here - if fields stop matching, check:
 * https://developers.google.com/maps/documentation/routes/compute_route_directions
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  const blocked = await guard(req);

  if (blocked) {
    return blocked;
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_SERVER_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const { origin, destination, waypoints } = (await req.json()) as {
    origin: LatLng;
    destination: LatLng;
    waypoints?: LatLng[];
  };

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: {
      location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
    },
    ...(waypoints?.length
      ? {
          intermediates: waypoints.map((w) => ({
            location: { latLng: { latitude: w.lat, longitude: w.lng } },
          })),
        }
      : {}),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    extraComputations: ["TOLLS"],
    // Assumes an unmetered private/commercial vehicle. Adjust if you need
    // per-axle or truck-specific toll pricing.
    regionCode: "IN",
    units: "METRIC",
  };

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo,routes.legs.duration,routes.legs.distanceMeters",
      },
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();

  if (!res.ok || !data.routes?.length) {
    return NextResponse.json(
      { error: "Routes API did not return a route.", raw: data },
      { status: 502 }
    );
  }

  const route = data.routes[0];
  const price = route.travelAdvisory?.tollInfo?.estimatedPrice?.[0];
  const toSeconds = (d: unknown) =>
    parseInt(String(d ?? "0").replace("s", ""), 10) || 0;

  return NextResponse.json({
    distanceMeters: route.distanceMeters,
    durationSeconds: toSeconds(route.duration),
    encodedPolyline: route.polyline.encodedPolyline,
    legs: (route.legs ?? []).map((leg: any) => ({
      distanceMeters: leg.distanceMeters ?? 0,
      durationSeconds: toSeconds(leg.duration),
    })),
    tollInfo: price
      ? { estimatedPrice: `${price.currencyCode} ${price.units ?? 0}` }
      : undefined,
  });
}

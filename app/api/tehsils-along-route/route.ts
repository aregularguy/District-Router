import { NextRequest, NextResponse } from "next/server";
import { decodePolyline, sampleAlongPath } from "@/lib/geoUtils";
import type { TehsilStop } from "@/lib/types";

// How many points along the route to reverse-geocode. Each one is a
// Geocoding API call, so this is a direct cost/latency knob.
const SAMPLE_COUNT = 8;

/**
 * POST { encodedPolyline: string }
 *
 * There's no Google layer for tehsils (India's sub-district admin units),
 * so this approximates them: sample points along the route and reverse
 * geocode each one, reading whichever address component Google mapped the
 * tehsil/taluk to locally (this varies by state - administrative_area_level_3
 * is the most common, sublocality_level_1 is the fallback).
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_SERVER_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const { encodedPolyline } = (await req.json()) as { encodedPolyline: string };
  const path = decodePolyline(encodedPolyline);
  const samples = sampleAlongPath(path, SAMPLE_COUNT);

  const results = await Promise.all(
    samples.map(async (point) => {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${point.lat},${point.lng}`);
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.status !== "OK" || !data.results?.length) return null;

      const components = data.results[0].address_components as {
        long_name: string;
        types: string[];
      }[];

      const tehsil =
        components.find((c) => c.types.includes("administrative_area_level_3")) ??
        components.find((c) => c.types.includes("sublocality_level_1")) ??
        components.find((c) => c.types.includes("locality"));

      if (!tehsil) return null;

      return { name: tehsil.long_name, position: point } satisfies TehsilStop;
    })
  );

  // Collapse consecutive duplicates (the same tehsil showing up across
  // several nearby samples) while keeping the route order.
  const tehsils: TehsilStop[] = [];
  for (const t of results) {
    if (!t) continue;
    if (tehsils[tehsils.length - 1]?.name === t.name) continue;
    tehsils.push(t);
  }

  return NextResponse.json({ tehsils });
}

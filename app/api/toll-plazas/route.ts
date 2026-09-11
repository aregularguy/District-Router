import { NextRequest, NextResponse } from "next/server";
import type { LatLng, TollPlaza } from "@/lib/types";
import { guard } from "@/lib/apiGuard";

/**
 * POST { encodedPolyline: string, vehicleType?: string }
 *
 * Google's Routes API gives a route-total toll estimate but not the toll
 * plaza *locations*. TollGuru takes the same Google-encoded polyline and
 * returns every plaza on the route with coordinates and per-vehicle price
 * (FASTag + cash), already in travel order.
 *
 * Toll plaza markers are a nice-to-have, so any failure here degrades to an
 * empty list + warning rather than erroring the whole route.
 *
 * Endpoint / payload reference:
 * https://github.com/mapup/tollguru-api-parameter-examples
 */
const TOLLGURU_URL =
  "https://apis.tollguru.com/toll/v2/complete-polyline-from-mapping-service";

// TollGuru vehicle types: 2AxlesAuto (car), 2AxlesTaxi, 2AxlesLCV,
// 2AxlesTruck, 3AxlesTruck, 2AxlesMotorcycle, ... Default to a private car.
const DEFAULT_VEHICLE_TYPE = "2AxlesAuto";

interface TollGuruEndpoint {
  lat?: number;
  lng?: number;
  name?: string;
  road?: string;
}

interface TollGuruToll {
  tagCost?: number | null;
  cashCost?: number | null;
  prepaidCardCost?: number | null;
  currency?: string;
  start?: TollGuruEndpoint;
  end?: TollGuruEndpoint;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.TOLLGURU_API_KEY;
   const blocked = await guard(req);
  
    if (blocked) {
      return blocked;
    }
  const { encodedPolyline, vehicleType } = (await req.json()) as {
    encodedPolyline: string;
    vehicleType?: string;
  };

  if (!apiKey) {
    return NextResponse.json({
      tollPlazas: [],
      warning: "TOLLGURU_API_KEY is not configured on the server.",
    });
  }

  let data: any;
  try {
    const res = await fetch(TOLLGURU_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        polyline: encodedPolyline,
        vehicle: { type: vehicleType ?? DEFAULT_VEHICLE_TYPE },
        departure_time: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    data = await res.json();

    if (!res.ok || data?.status !== "OK") {
      return NextResponse.json({
        tollPlazas: [],
        warning: `TollGuru request failed (${res.status}): ${
          data?.message ?? data?.status ?? "unknown error"
        }`,
      });
    }
  } catch {
    return NextResponse.json({
      tollPlazas: [],
      warning: "Toll plaza lookup timed out (TollGuru).",
    });
  }

  const tolls: TollGuruToll[] = data?.route?.tolls ?? [];

  const tollPlazas: TollPlaza[] = tolls.flatMap((t) => {
    const at = t.start ?? t.end;
    if (typeof at?.lat !== "number" || typeof at?.lng !== "number") return [];
    const position: LatLng = { lat: at.lat, lng: at.lng };
    return [
      {
        name: at.name?.trim() || "Toll plaza",
        position,
        road: at.road,
        tagCost: t.tagCost ?? undefined,
        cashCost: t.cashCost ?? undefined,
        currency: t.currency ?? "INR",
      },
    ];
  });

  // Route-total: prefer the "pay by FASTag / cash" figure, then plain tag.
  const costs = data?.route?.costs ?? {};
  const total: number | undefined =
    typeof costs.tagAndCash === "number"
      ? costs.tagAndCash
      : typeof costs.minimumTollCost === "number"
      ? costs.minimumTollCost
      : typeof costs.tag === "number"
      ? costs.tag
      : typeof costs.cash === "number"
      ? costs.cash
      : undefined;
  const currency = tollPlazas[0]?.currency ?? "INR";

  return NextResponse.json({
    tollPlazas,
    tollTotal:
      total !== undefined ? `${currency} ${Math.round(total)}` : undefined,
  });
}

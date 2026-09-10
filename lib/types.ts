export interface LatLng {
  lat: number;
  lng: number;
}

export interface SourceLocation {
  id: string;
  name: string;
  position: LatLng;
  /** Google `administrative_area_level_2` name, when resolved from the click. */
  district?: string;
  /** Which corridor this source's route is forced onto (see lib/corridors). */
  corridorId?: string;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
}

export interface DestinationPoint {
  name: string;
  position: LatLng;
  /** Best-guess administrative label, e.g. "Indore District, Madhya Pradesh" */
  formattedAddress?: string;
}

export interface TehsilStop {
  name: string;
  position: LatLng;
}

export interface TollPlaza {
  name: string;
  position: LatLng;
  /** Highway the plaza sits on, e.g. "NH-48" (from TollGuru). */
  road?: string;
  /** FASTag price in `currency`, if known. */
  tagCost?: number;
  /** Cash price in `currency`, if known. */
  cashCost?: number;
  /** ISO currency code, e.g. "INR". */
  currency?: string;
}

export interface TollInfo {
  /** e.g. "INR 145" - a route-total toll estimate (Google Routes or TollGuru) */
  estimatedPrice?: string;
}

export interface RouteResult {
  source: SourceLocation;
  destination: DestinationPoint;
  /** The corridor this route was computed with. */
  corridorId: string;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  path: LatLng[];
  /** One entry per source→waypoint→…→destination segment (Routes API legs). */
  legs?: RouteLeg[];
  tollInfo?: TollInfo;
  tehsils: TehsilStop[];
  tollPlazas: TollPlaza[];
  /** True until the tehsil / toll enrichment call finishes. */
  enriching?: boolean;
  /** Set when toll plaza lookup was skipped or failed (e.g. no API key). */
  tollNote?: string;
}

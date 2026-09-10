import { decode } from "@googlemaps/polyline-codec";
import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Decode a Google-encoded polyline into a list of {lat, lng} points. */
export function decodePolyline(encoded: string): LatLng[] {
  return decode(encoded, 5).map(([lat, lng]) => ({ lat, lng }));
}

/**
 * Pick evenly spaced points along a path, by arc length rather than by
 * vertex count, so long straight stretches don't get over-sampled and
 * dense curvy stretches don't get under-sampled.
 */
export function sampleAlongPath(path: LatLng[], targetCount: number): LatLng[] {
  if (path.length <= targetCount) return path;

  const cumulative: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength === 0) return [path[0]];

  const samples: LatLng[] = [];
  for (let s = 0; s < targetCount; s++) {
    const targetDist = (s / (targetCount - 1)) * totalLength;
    let idx = cumulative.findIndex((d) => d >= targetDist);
    if (idx === -1) idx = path.length - 1;
    samples.push(path[idx]);
  }
  return samples;
}

/** Shortest distance in meters from a point to a polyline (path). */
export function distanceToPath(point: LatLng, path: LatLng[]): number {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegment(point, path[i], path[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  // Work in a local equirectangular projection - fine at road-segment scale.
  const lat0 = toRad(a.lat);
  const project = (pt: LatLng) => ({
    x: toRad(pt.lng) * Math.cos(lat0) * EARTH_RADIUS_M,
    y: toRad(pt.lat) * EARTH_RADIUS_M,
  });

  const pp = project(p);
  const pa = project(a);
  const pb = project(b);

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;

  let t = lengthSq === 0 ? 0 : ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closest = { x: pa.x + t * dx, y: pa.y + t * dy };
  return Math.hypot(pp.x - closest.x, pp.y - closest.y);
}

/** Bounding box around a path, padded outward by `paddingMeters`. */
export function boundingBoxWithPadding(path: LatLng[], paddingMeters: number) {
  const lats = path.map((p) => p.lat);
  const lngs = path.map((p) => p.lng);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);

  // Rough meters-per-degree at this latitude.
  const midLat = (south + north) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(toRad(midLat));

  const padLat = paddingMeters / metersPerDegLat;
  const padLng = paddingMeters / Math.max(metersPerDegLng, 1);

  return {
    south: south - padLat,
    north: north + padLat,
    west: west - padLng,
    east: east + padLng,
  };
}

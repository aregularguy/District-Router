# District Router

A Next.js app for logistics-style routing: add one or more source locations,
pick a destination district (or click the map), and get the closest source's
route — with distance, drive time, an estimated toll cost, the tehsils the
route passes through, and toll plazas along the way.

## How it fits together

| Feature | Data source |
|---|---|
| Map, search box, marker rendering | Google Maps JavaScript API + Places API |
| "Which source is closest?" | Google Distance Matrix API (all sources vs. one destination, one call) |
| Route line, distance, duration, toll estimate | Google Routes API (`computeRoutes`) |
| Tehsils along the route | Reverse geocoding (Geocoding API) sampled at points along the route — approximate, since Google has no tehsil boundary layer |
| Toll plaza pins | OpenStreetMap Overpass API (`barrier=toll_booth` nodes near the route) — Google doesn't expose toll plaza point locations, only a price estimate |

No static district/tehsil dataset is bundled or required — destination search
and tehsil naming both ride on Google's own data, which matches "approximate
is fine, no precise boundaries" scope.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Get two Google Maps API keys** (Google Cloud Console → APIs & Services →
   Credentials). Using two keys with different restrictions is deliberate —
   one is public (ships to the browser), one never leaves your server.

   - **Browser key** (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`): restrict by HTTP
     referrer to your domain. Enable: **Maps JavaScript API**, **Places API**.
   - **Server key** (`GOOGLE_MAPS_SERVER_API_KEY`): restrict by server IP.
     Enable: **Distance Matrix API**, **Routes API**, **Geocoding API**.

   Billing must be enabled on the Google Cloud project for these APIs to
   respond (they all have a free monthly credit, but none work on a
   brand-new project with billing off).

3. **Copy the env file and fill in the keys**
   ```bash
   cp .env.local.example .env.local
   ```

4. **Run it**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

## Using the app

- **Add sources**: search an address in the "Sources" box, or click
  "Add by clicking map" and click points on the map.
- **Pick a destination**: search a district/tehsil/town in the "Destination"
  box, or just click anywhere on the map (this reverse-geocodes the click
  to a readable label).
- As soon as you have ≥1 source and a destination, the app calls the APIs
  automatically and fills in the results panel and map.

## Known limitations (worth knowing before you rely on this)

- **Tehsil detection is approximate.** It samples ~8 points along the route
  and reverse-geocodes each one. Short routes, or tehsils the route only
  clips the corner of, can be missed. If you later get access to an actual
  tehsil boundary GeoJSON, swap `/app/api/tehsils-along-route` for a
  point-in-polygon check against that instead — it'll be exact rather than
  sampled.
- **Toll data comes from two different, sometimes-inconsistent sources.**
  The toll *price* is Google's estimate; the toll *plaza locations* are
  OpenStreetMap's. OSM's India toll-booth tagging is decent on national
  highways but not complete everywhere, so absence of a pin doesn't
  guarantee there's no toll.
- **Overpass API is a shared public service** (overpass-api.de) with fair-use
  rate limits. Fine for development and light use; for production traffic,
  either self-host an Overpass instance or cache results per route.
- **"Optimal" here means shortest distance**, not fastest or cheapest. If you
  want "fastest," change the comparison in
  `/app/api/optimal-source/route.ts` from `distanceMeters` to
  `durationSeconds`.
- **Routes API toll pricing assumes a standard private vehicle.** For trucks
  or per-axle commercial pricing you'll need to add `vehicleInfo` /
  `routeModifiers` to the request in `/app/api/route-details/route.ts` per
  the [Routes API toll docs](https://developers.google.com/maps/documentation/routes/coverage#tolls).

## Project structure

```
app/
  api/
    optimal-source/     Distance Matrix: pick the closest source
    route-details/      Routes API: path, distance, duration, toll estimate
    tehsils-along-route/ Reverse geocode sampled points → tehsil names
    toll-plazas/         Overpass query → toll booth pins near the route
  page.tsx               Renders <MapDashboard />
  layout.tsx, globals.css, dashboard.css
components/
  MapDashboard.tsx        State + orchestration
  MapView.tsx              The Google Map itself
  SourceManager.tsx        Add/remove source locations
  DestinationPicker.tsx    Destination search
  RouteResultsPanel.tsx    Results sidebar
lib/
  types.ts       Shared TypeScript types
  geoUtils.ts    Polyline decode/sample, distance math, bounding boxes
```

import type { LatLng } from "./types";

export interface CorridorWaypoint {
  name: string;
  position: LatLng;
}

export interface Corridor {
  id: string;
  /** Full label for the legend / route panel. */
  label: string;
  /** Compact label for the per-source dropdown. */
  short: string;
  color: string;
  /**
   * Ordered points the route is forced through (Routes API `intermediates`).
   * Spacing them along the real road pins the route to that corridor.
   *
   * IMPORTANT: put a waypoint on the road you want used, NOT on the town
   * centre. A town-centre point makes the router dive into the town; a point
   * on the bypass keeps traffic on the bypass. Waypoints are draggable on the
   * map, so these are just sensible defaults.
   */
  waypoints: CorridorWaypoint[];
}

// Coordinates: OpenStreetMap, verified by routing against the live Routes API
// and checking how close the resulting polyline gets to Phaltan's town
// junction (17.9918, 74.4383). The pair below keeps it ~1.5 km clear.
const SASWAD: CorridorWaypoint = {
  name: "Saswad",
  position: { lat: 18.3444347, lng: 74.0295234 },
};
// Traffic from Mumbai/Thane must not be dragged through Pune city to reach
// Saswad. These two keep it on NH-48 past the Pune bypass, then turn east at
// Shirwal for Lonand and Phaltan.
const SHIRWAL: CorridorWaypoint = {
  name: "Shirwal",
  position: { lat: 18.1479101, lng: 73.976653 },
};
const LONAND: CorridorWaypoint = {
  name: "Lonand",
  position: { lat: 18.0387975, lng: 74.186926 },
};
// The bypass is the northern arc (Malegaon Shirwali Road and the lanes east of
// it) that leaves NH-965/Pandharpur Road, skirts Phaltan at lat ~18.010 and
// rejoins NH-965 east of the town. A waypoint left on Pandharpur Road itself
// pins the route BEFORE that turn-off, which sends it straight down NH-965
// through the Jinti Naka junction and into Phaltan - so this point sits on the
// top of the arc, ~1.5 km clear of the town junction.
const PHALTAN_BYPASS_N: CorridorWaypoint = {
  name: "Phaltan bypass (N)",
  position: { lat: 18.01049, lng: 74.42945 },
};
const PHALTAN_BYPASS_E: CorridorWaypoint = {
  name: "Phaltan bypass (E)",
  position: { lat: 17.987909, lng: 74.461814 },
};
const AKLUJ: CorridorWaypoint = {
  name: "Akluj",
  position: { lat: 17.8930069, lng: 75.0204482 },
};
const SANGOLA: CorridorWaypoint = {
  name: "Sangola",
  position: { lat: 17.4367612, lng: 75.1881756 },
};

export const DEFAULT_CORRIDORS: Corridor[] = [
  {
    id: "direct",
    label: "Direct (Google's shortest route)",
    short: "Direct",
    color: "#f59e0b",
    waypoints: [],
  },
  {
    id: "pune-saswad",
    label: "Saswad → Phaltan bypass → Akluj → Sangola",
    short: "Via Saswad",
    color: "#4c9dff",
    waypoints: [SASWAD, PHALTAN_BYPASS_N, PHALTAN_BYPASS_E, AKLUJ, SANGOLA],
  },
  {
    id: "shirwal-lonand",
    label: "NH-48 → Shirwal → Lonand → Phaltan bypass → Akluj → Sangola",
    short: "Via Shirwal",
    color: "#a78bfa",
    waypoints: [
      SHIRWAL,
      LONAND,
      PHALTAN_BYPASS_N,
      PHALTAN_BYPASS_E,
      AKLUJ,
      SANGOLA,
    ],
  },
];

export const DEFAULT_CORRIDOR_ID = "direct";

/**
 * Which corridor a district's traffic is routed onto by default. The point of
 * the tool: keep NH-48 (Satara–Vita–Nagaj) clear during the gathering by
 * pushing the north/west catchment onto the Phaltan corridor. Overridable
 * per source in the sidebar.
 *
 * Keys are Google `administrative_area_level_2` long names (a few aliases
 * included - Ahmadnagar was renamed Ahilyanagar in 2023, and Google sometimes
 * returns divisions like "Pune Division").
 */
export const DISTRICT_CORRIDOR: Record<string, string> = {
  // Pune's own traffic exits east via Hadapsar/Saswad.
  Pune: "pune-saswad",
  "Pune Division": "pune-saswad",
  "Pune District": "pune-saswad",
  // Ahmadnagar funnels through the Pune side too. REVIEW: it may be better on
  // "direct" since it approaches from the east and wouldn't load NH-48.
  Ahmadnagar: "pune-saswad",
  Ahilyanagar: "pune-saswad",
  Ahmednagar: "pune-saswad",

  // Everything further north stays on NH-48 past Pune and turns off at
  // Shirwal - routing these through Pune city is not feasible.
  Thane: "shirwal-lonand",
  "Thane District": "shirwal-lonand",
  "Konkan Division": "shirwal-lonand",
  Mumbai: "shirwal-lonand",
  "Mumbai City": "shirwal-lonand",
  "Mumbai Suburban": "shirwal-lonand",
  "Greater Bombay": "shirwal-lonand",
  Raigad: "shirwal-lonand",
  Raigarh: "shirwal-lonand",
  Palghar: "shirwal-lonand",
  Nashik: "shirwal-lonand",
  "Nashik Division": "shirwal-lonand",
};

export function corridorForDistrict(district?: string): string {
  if (!district) return DEFAULT_CORRIDOR_ID;
  return DISTRICT_CORRIDOR[district.trim()] ?? DEFAULT_CORRIDOR_ID;
}

export function getCorridor(corridors: Corridor[], id?: string): Corridor {
  return corridors.find((c) => c.id === id) ?? corridors[0];
}

// --- Persistence -----------------------------------------------------------
// Waypoints are draggable, so a tuned corridor should survive a reload.

const STORAGE_KEY = "district-router:corridors:v3";

export function loadCorridors(): Corridor[] {
  if (typeof window === "undefined") return DEFAULT_CORRIDORS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CORRIDORS;
    const saved = JSON.parse(raw) as Corridor[];
    if (!Array.isArray(saved) || !saved.length) return DEFAULT_CORRIDORS;
    // Keep the shipped label/colour, take only the tuned waypoints, and keep
    // any corridor added to the defaults since the user last saved.
    return DEFAULT_CORRIDORS.map((base) => {
      const match = saved.find((c) => c.id === base.id);
      return match?.waypoints ? { ...base, waypoints: match.waypoints } : base;
    });
  } catch {
    return DEFAULT_CORRIDORS;
  }
}

export function saveCorridors(corridors: Corridor[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(corridors));
  } catch {
    // Private mode / quota - tuning just won't persist.
  }
}

export function clearSavedCorridors() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

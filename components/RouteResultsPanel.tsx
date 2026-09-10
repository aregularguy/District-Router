"use client";

import { getCorridor, type Corridor } from "@/lib/corridors";
import type { RouteResult } from "@/lib/types";

function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

function formatTollCost(cost?: number, currency = "INR") {
  if (typeof cost !== "number") return null;
  return `${currency} ${Math.round(cost)}`;
}

interface Props {
  loading: boolean;
  error: string | null;
  result: RouteResult | null;
  corridors: Corridor[];
}

export default function RouteResultsPanel({
  loading,
  error,
  result,
  corridors,
}: Props) {
  if (loading) {
    return (
      <section>
        <div className="sectionHeader">
          <h2>Route</h2>
        </div>
        <p className="emptyHint">Calculating the route…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <div className="sectionHeader">
          <h2>Route</h2>
        </div>
        <p className="errorText">{error}</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section>
        <div className="sectionHeader">
          <h2>Route</h2>
        </div>
        <p className="emptyHint">
          Add sources and pick a gathering point, then click a source to trace
          its route.
        </p>
      </section>
    );
  }

  const corridor = getCorridor(corridors, result.corridorId);

  // Zip legs with the ordered stop names: source → waypoints → destination.
  const stopNames = [
    result.source.name,
    ...corridor.waypoints.map((w) => w.name),
    result.destination.name,
  ];
  const legs = (result.legs ?? []).map((leg, i) => ({
    from: stopNames[i] ?? `Stop ${i + 1}`,
    to: stopNames[i + 1] ?? `Stop ${i + 2}`,
    ...leg,
  }));

  return (
    <section>
      <div className="sectionHeader">
        <h2>Route</h2>
      </div>

      <div className="statGrid">
        <div className="statBlock">
          <span className="statLabel">Distance</span>
          <span className="statValue numeral">
            {formatDistance(result.distanceMeters)}
          </span>
        </div>
        <div className="statBlock">
          <span className="statLabel">Drive time</span>
          <span className="statValue numeral">
            {formatDuration(result.durationSeconds)}
          </span>
        </div>
        <div className="statBlock">
          <span className="statLabel">Estimated toll</span>
          <span className="statValue numeral">
            {result.tollInfo?.estimatedPrice ?? "—"}
          </span>
        </div>
      </div>

      <p className="routeSummary">
        <strong>{result.source.name}</strong>
        {result.source.district ? ` (${result.source.district})` : ""} →{" "}
        <strong>{result.destination.name}</strong>
        <br />
        <span className="muted">
          Corridor: <span style={{ color: corridor.color }}>{corridor.short}</span>
        </span>
      </p>

      {legs.length > 1 && (
        <div className="subsection">
          <h3>Legs</h3>
          <ul className="stopList">
            {legs.map((leg, i) => (
              <li key={i} className="legRow">
                <span>
                  {leg.from} → {leg.to}
                </span>
                <span className="muted numeral">
                  {formatDistance(leg.distanceMeters)} ·{" "}
                  {formatDuration(leg.durationSeconds)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="subsection">
        <h3>
          Tehsils on the way ({result.tehsils.length})
          {result.enriching ? " …" : ""}
        </h3>
        {result.tehsils.length === 0 ? (
          <p className="emptyHint">
            {result.enriching
              ? "Scanning the route…"
              : "No intermediate tehsils identified for this route."}
          </p>
        ) : (
          <ol className="stopList">
            {result.tehsils.map((t, i) => (
              <li key={`${t.name}-${i}`}>{t.name}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="subsection">
        <h3>
          Toll plazas ({result.tollPlazas.length})
          {result.enriching ? " …" : ""}
        </h3>
        {result.tollPlazas.length === 0 ? (
          <p className="emptyHint">
            {result.enriching
              ? "Checking tolls…"
              : result.tollNote ?? "No toll plazas detected on this route."}
          </p>
        ) : (
          <ul className="stopList">
            {result.tollPlazas.map((t, i) => {
              const cost = formatTollCost(t.tagCost ?? t.cashCost, t.currency);
              return (
                <li key={`${t.name}-${i}`}>
                  {t.name}
                  {t.road ? ` · ${t.road}` : ""}
                  {cost ? ` — ${cost}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

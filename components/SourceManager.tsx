"use client";

import { Autocomplete } from "@react-google-maps/api";
import { useRef, useState } from "react";
import { getCorridor, type Corridor } from "@/lib/corridors";
import type { SourceLocation } from "@/lib/types";

interface Props {
  sources: SourceLocation[];
  corridors: Corridor[];
  selectedSourceId: string | null;
  addSourceMode: boolean;
  onToggleAddMode: () => void;
  onAddSource: (source: SourceLocation) => void;
  onRemoveSource: (id: string) => void;
  onSelectSource: (id: string) => void;
  onSetCorridor: (id: string, corridorId: string) => void;
}

export default function SourceManager({
  sources,
  corridors,
  selectedSourceId,
  addSourceMode,
  onToggleAddMode,
  onAddSource,
  onRemoveSource,
  onSelectSource,
  onSetCorridor,
}: Props) {
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [searchValue, setSearchValue] = useState("");

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;

    const district = place.address_components?.find((c) =>
      c.types.includes("administrative_area_level_2")
    )?.long_name;

    onAddSource({
      id: crypto.randomUUID(),
      name: place.name ?? place.formatted_address ?? "Source",
      position: { lat: loc.lat(), lng: loc.lng() },
      district,
    });
    setSearchValue("");
  };

  return (
    <section>
      <div className="sectionHeader">
        <h2>Sources</h2>
        <button
          className={`pillButton ${addSourceMode ? "pillButtonActive" : ""}`}
          onClick={onToggleAddMode}
        >
          {addSourceMode ? "Click map to place" : "+ Add by clicking map"}
        </button>
      </div>

      <Autocomplete
        onLoad={(a) => (autocompleteRef.current = a)}
        onPlaceChanged={handlePlaceChanged}
        options={{ componentRestrictions: { country: "in" } }}
      >
        <input
          className="textInput"
          placeholder="Or search an address / warehouse..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
      </Autocomplete>

      {sources.length === 0 ? (
        <p className="emptyHint">
          No sources yet. Search above or click the map to drop one.
        </p>
      ) : (
        <ul className="sourceList">
          {sources.map((s) => {
            const active = s.id === selectedSourceId;
            const corridor = getCorridor(corridors, s.corridorId);
            return (
              <li
                key={s.id}
                className={`sourceRow ${active ? "sourceRowActive" : ""}`}
                onClick={() => onSelectSource(s.id)}
              >
                <div className="sourceRowMain">
                  <span
                    className="dot"
                    style={{ background: active ? "#4fd1c5" : "#5b6b7a" }}
                  />
                  <span className="sourceName">{s.name}</span>
                  {active && <span className="bestTag">tracing</span>}
                  <button
                    className="removeButton"
                    aria-label={`Remove ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSource(s.id);
                    }}
                  >
                    ×
                  </button>
                </div>
                <label
                  className="corridorPicker"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span
                    className="corridorSwatch"
                    style={{ background: corridor.color }}
                  />
                  <select
                    value={corridor.id}
                    onChange={(e) => onSetCorridor(s.id, e.target.value)}
                  >
                    {corridors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.short}
                      </option>
                    ))}
                  </select>
                  {s.district && (
                    <span className="corridorDistrict muted">{s.district}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

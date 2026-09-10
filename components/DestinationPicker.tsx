"use client";

import { Autocomplete } from "@react-google-maps/api";
import { useRef, useState } from "react";
import type { DestinationPoint } from "@/lib/types";

interface Props {
  destination: DestinationPoint | null;
  onSelect: (destination: DestinationPoint) => void;
  onClear: () => void;
}

export default function DestinationPicker({
  destination,
  onSelect,
  onClear,
}: Props) {
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [searchValue, setSearchValue] = useState("");

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;

    onSelect({
      name: place.name ?? place.formatted_address ?? "Destination",
      position: { lat: loc.lat(), lng: loc.lng() },
      formattedAddress: place.formatted_address,
    });
    setSearchValue("");
  };

  return (
    <section>
      <div className="sectionHeader">
        <h2>Destination</h2>
      </div>

      <Autocomplete
        onLoad={(a) => (autocompleteRef.current = a)}
        onPlaceChanged={handlePlaceChanged}
        options={{
          types: ["(regions)"],
          componentRestrictions: { country: "in" },
        }}
      >
        <input
          className="textInput"
          placeholder="Search a district, tehsil, or town..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
      </Autocomplete>

      <p className="hint">
        Or click anywhere on the map to set that point as the destination.
      </p>

      {destination && (
        <div className="destinationCard">
          <div className="destinationCardHead">
            <strong>{destination.name}</strong>
            <button
              className="removeButton"
              aria-label="Clear destination"
              onClick={onClear}
            >
              ×
            </button>
          </div>
          {destination.formattedAddress && (
            <span className="muted">{destination.formattedAddress}</span>
          )}
        </div>
      )}
    </section>
  );
}

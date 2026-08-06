import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, X, Loader2, CheckCircle2 } from "lucide-react";

const SCRIPT_ID = "gmaps-places-script";
const CALLBACK_NAME = "__gmInitPlaces";

// Resolve API key from env. Supports VITE_GOOGLE_MAPS_API_KEY (project default)
// with VITE_GOOGLE_PLACES_API_KEY as a fallback.
function resolveMapsKey() {
  return (
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    import.meta.env.VITE_GOOGLE_PLACES_API_KEY ||
    ""
  );
}

// Returns a promise that resolves once google.maps is loaded.
function loadGoogleMaps(apiKey) {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);

  if (window.__gmLoaderPromise) return window.__gmLoaderPromise;

  window.__gmLoaderPromise = new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error("Missing Google Maps API key"));
      return;
    }

    // If a script tag is already present (e.g. added by another component),
    // just wait for google.maps to appear.
    const existing = document.getElementById(SCRIPT_ID) ||
      document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      const poll = setInterval(() => {
        if (window.google?.maps?.importLibrary) {
          clearInterval(poll);
          resolve(window.google);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(poll);
        if (!window.google?.maps?.importLibrary) {
          reject(new Error("Google Maps failed to initialize"));
        }
      }, 15000);
      return;
    }

    window[CALLBACK_NAME] = () => {
      resolve(window.google);
    };

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&v=weekly&libraries=places&loading=async&callback=${CALLBACK_NAME}`;
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return window.__gmLoaderPromise;
}

function mapAddressComponents(components = []) {
  let street = "";
  let city = "";
  let state = "";
  let country = "";
  components.forEach((c) => {
    const types = c.types || [];
    if (types.includes("street_number") || types.includes("route")) {
      street += (c.longText || c.long_name || "") + " ";
    } else if (types.includes("locality") || types.includes("sublocality")) {
      city = c.longText || c.long_name || city;
    } else if (types.includes("administrative_area_level_1")) {
      state = c.longText || c.long_name || state;
    } else if (types.includes("country")) {
      country = c.longText || c.long_name || country;
    }
  });
  return { street: street.trim(), city, state, country };
}

const GooglePlacesInput = ({
  value,
  onChange,
  onConfirm,
  placeholder = "Search for address...",
  disabled = false,
  className = "",
  biasState = "",
  biasLga = "",
  autoFocus = false,
}) => {
  const [scriptStatus, setScriptStatus] = useState("loading"); // loading | ready | unavailable
  const [suggestionsError, setSuggestionsError] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputValue, setInputValue] = useState(value?.fullAddress || "");
  const [searching, setSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const placesLibRef = useRef(null); // { AutocompleteSuggestion, AutocompleteSessionToken }
  const geocoderRef = useRef(null); // google.maps.Geocoder for LGA/State biasing
  const locationBiasRef = useRef(null); // { center: {lat,lng}, radius } derived from LGA/State
  const sessionTokenRef = useRef(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Sync external value
  useEffect(() => {
    setInputValue(value?.fullAddress || "");
  }, [value?.fullAddress]);

  // Load Maps JS + Places (New) library
  useEffect(() => {
    let cancelled = false;
    const key = resolveMapsKey();
    if (!key) {
      // eslint-disable-next-line no-console
      console.error(
        "[GooglePlacesInput] VITE_GOOGLE_MAPS_API_KEY is not set — address suggestions disabled."
      );
      setScriptStatus("unavailable");
      setSuggestionsError(
        "Google Maps API key missing. You can still type an address manually."
      );
      return () => {};
    }

    loadGoogleMaps(key)
      .then(async (google) => {
        if (cancelled) return;
        try {
          const lib = await google.maps.importLibrary("places");
          if (cancelled) return;
          placesLibRef.current = {
            AutocompleteSuggestion: lib.AutocompleteSuggestion,
            AutocompleteSessionToken: lib.AutocompleteSessionToken,
            Place: lib.Place,
          };
          sessionTokenRef.current = new lib.AutocompleteSessionToken();
          // Geocoding library powers LGA/State location biasing. Optional —
          // if it fails to load we simply fall back to nationwide suggestions.
          try {
            const geoLib = await google.maps.importLibrary("geocoding");
            if (!cancelled && geoLib?.Geocoder) {
              geocoderRef.current = new geoLib.Geocoder();
            }
          } catch {
            // Non-fatal: biasing just stays disabled.
          }
          setScriptStatus("ready");
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[GooglePlacesInput] Failed to load Places library", err);
          setScriptStatus("unavailable");
          setSuggestionsError(
            "Address suggestions unavailable — enable Places API (New) in your Google Cloud project."
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[GooglePlacesInput] Maps JS load failed", err);
        setScriptStatus("unavailable");
        setSuggestionsError(
          "Could not load Google Maps. Check your API key and that this domain is allowed."
        );
      });

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const emitChange = useCallback(
    (next) => {
      if (onChange) onChange(next);
    },
    [onChange]
  );

  // Whenever the selected State/LGA changes, geocode it to a center point so
  // autocomplete results near that LGA/State are ranked first. Falls back to
  // nationwide suggestions when nothing is selected or geocoding fails.
  useEffect(() => {
    if (scriptStatus !== "ready" || !geocoderRef.current) return;

    const state = biasState?.trim();
    const lga = biasLga?.trim();
    if (!state) {
      locationBiasRef.current = null;
      return;
    }

    let cancelled = false;
    const address = [lga, state, "Nigeria"].filter(Boolean).join(", ");
    geocoderRef.current
      .geocode({ address, region: "ng" })
      .then((res) => {
        if (cancelled) return;
        const loc = res?.results?.[0]?.geometry?.location;
        if (!loc) {
          locationBiasRef.current = null;
          return;
        }
        locationBiasRef.current = {
          center: { lat: loc.lat(), lng: loc.lng() },
          // Tighter radius when an LGA is chosen, wider for state-only.
          // Google caps locationBias circle radius at 50,000 m — going over
          // (the old 60,000) throws "Radius must be between 0 and 50,000 meters"
          // and kills autocomplete entirely.
          radius: lga ? 20000 : 50000,
        };
      })
      .catch(() => {
        if (!cancelled) locationBiasRef.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [biasState, biasLga, scriptStatus]);

  const fetchSuggestions = useCallback(async (input) => {
    const lib = placesLibRef.current;
    if (!lib?.AutocompleteSuggestion) return;
    try {
      setSearching(true);
      const request = {
        input,
        sessionToken: sessionTokenRef.current,
        includedRegionCodes: ["ng"],
      };
      if (locationBiasRef.current) {
        request.locationBias = locationBiasRef.current;
      }
      const { suggestions } =
        await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      // Don't touch showSuggestions here — it's driven by whether there's
      // typed text (see handleInputChange), not by whether Google found a
      // match. A zero-result address (village, landmark) must still show the
      // dropdown so "Use as entered" stays reachable.
      setPredictions(suggestions || []);
      setSuggestionsError(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GooglePlacesInput] fetchAutocompleteSuggestions failed", err);
      setPredictions([]);
      const msg = String(err?.message || err || "");
      if (/REQUEST_DENIED|ApiNotActivated|not.*enabled/i.test(msg)) {
        setSuggestionsError(
          "Address suggestions unavailable — enable Places API (New) in your Google Cloud project."
        );
      } else {
        setSuggestionsError("Address suggestions temporarily unavailable.");
      }
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInputChange = (e) => {
    const text = e.target.value;
    setInputValue(text);

    // Always emit a free-text update so the form can save even without a
    // pick — the typed text IS the address either way, selecting "Use as
    // entered" or a suggestion is just an explicit confirmation, not a
    // requirement. Preserve any GPS coords already captured (e.g. the
    // background auto-capture) — typing an address must not wipe them.
    emitChange({
      fullAddress: text,
      street: "",
      city: "",
      state: "",
      country: value?.country || "Nigeria",
      latitude: value?.latitude ?? null,
      longitude: value?.longitude ?? null,
    });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setPredictions([]);
      setShowSuggestions(false);
      return;
    }
    // Show the dropdown as soon as there's typed text — independent of
    // Google having a match — so "Use as entered" is always reachable.
    setShowSuggestions(true);
    if (scriptStatus !== "ready") return;
    debounceRef.current = setTimeout(() => fetchSuggestions(text.trim()), 250);
  };

  const handlePlaceSelect = async (suggestion) => {
    const lib = placesLibRef.current;
    if (!lib) return;
    try {
      const placePrediction = suggestion.placePrediction;
      if (!placePrediction) return;
      const place = placePrediction.toPlace();
      await place.fetchFields({
        fields: [
          "formattedAddress",
          "addressComponents",
          "location",
          "displayName",
        ],
      });

      const formatted = place.formattedAddress || placePrediction.text?.text || "";
      const { street, city, state, country } = mapAddressComponents(
        place.addressComponents || []
      );

      const addressData = {
        fullAddress: formatted,
        street: street || place.displayName || "",
        city,
        state,
        country: country || "Nigeria",
        latitude: place.location?.lat?.() ?? place.location?.lat ?? null,
        longitude: place.location?.lng?.() ?? place.location?.lng ?? null,
      };

      setInputValue(formatted);
      setShowSuggestions(false);
      setPredictions([]);
      // Reset session token — Google bills per session ended by a details fetch.
      if (lib.AutocompleteSessionToken) {
        sessionTokenRef.current = new lib.AutocompleteSessionToken();
      }
      emitChange(addressData);
      onConfirm?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GooglePlacesInput] place details fetch failed", err);
      setSuggestionsError("Could not load place details. Try again.");
    }
  };

  const clearAddress = () => {
    setInputValue("");
    setPredictions([]);
    setShowSuggestions(false);
    emitChange({
      fullAddress: "",
      street: "",
      city: "",
      state: "",
      country: "Nigeria",
      latitude: null,
      longitude: null,
    });
  };

  const showLoadingHint = scriptStatus === "loading" && !inputValue;

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={`pl-10 pr-16 ${className}`}
          onFocus={() => {
            setIsFocused(true);
            if (predictions.length > 0 || inputValue.trim()) setShowSuggestions(true);
          }}
          onBlur={() => {
            setIsFocused(false);
            // Deferred so a click on a suggestion/"use as entered" (which
            // already calls onConfirm directly and prevents this blur via
            // onMouseDown+preventDefault) always wins the race. This only
            // fires for a genuine "typed then looked away" blur.
            setTimeout(() => {
              setShowSuggestions(false);
              if (inputValue.trim()) onConfirm?.();
            }, 200);
          }}
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 animate-spin" />
        ) : inputValue ? (
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
            {/* Confirms an address is set — only once the agent isn't actively
                editing, so it doesn't compete with the suggestions dropdown. */}
            {!isFocused && <CheckCircle2 className="h-4 w-4 text-[#4a5d0f]" />}
            <button
              onClick={clearAddress}
              className="p-0.5 text-gray-400 hover:text-gray-600"
              type="button"
              tabIndex={-1}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {showLoadingHint && (
        <div className="mt-1 text-xs text-gray-500">
          Loading address suggestions…
        </div>
      )}

      {showSuggestions && (predictions.length > 0 || inputValue.trim()) && (
        <div className="absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-md mt-1 max-h-60 overflow-y-auto z-20 shadow-lg">
          {inputValue.trim() && (
            <button
              type="button"
              className="w-full text-left px-4 py-3 hover:bg-[#4a5d0f]/15 border-b border-gray-100 focus:bg-[#4a5d0f]/15 focus:outline-none bg-[#4a5d0f]/10"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowSuggestions(false);
                setPredictions([]);
                // Address is already being emitted on every keystroke — this
                // just confirms the typed text as-is (no Google match) for
                // addresses (villages, landmarks) Google doesn't resolve.
                emitChange({
                  fullAddress: inputValue,
                  street: "",
                  city: "",
                  state: "",
                  country: value?.country || "Nigeria",
                  latitude: value?.latitude ?? null,
                  longitude: value?.longitude ?? null,
                });
                onConfirm?.();
              }}
            >
              <div className="flex items-start">
                <MapPin className="h-4 w-4 text-[#4a5d0f] mt-0.5 mr-3 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#4a5d0f]">
                    Use &quot;{inputValue}&quot; as entered
                  </div>
                  <div className="text-xs text-[#4a5d0f]/70">No Google match needed</div>
                </div>
              </div>
            </button>
          )}
          {predictions.map((suggestion, idx) => {
            const pp = suggestion.placePrediction;
            if (!pp) return null;
            const main =
              pp.mainText?.text || pp.text?.text || "Unknown place";
            const secondary = pp.secondaryText?.text || "";
            return (
              <button
                key={pp.placeId || idx}
                type="button"
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 focus:bg-gray-50 focus:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePlaceSelect(suggestion)}
              >
                <div className="flex items-start">
                  <MapPin className="h-4 w-4 text-gray-400 mt-0.5 mr-3 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {main}
                    </div>
                    {secondary && (
                      <div className="text-xs text-gray-500">{secondary}</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {suggestionsError && !showSuggestions && (
        <div className="mt-1 text-xs text-amber-700">{suggestionsError}</div>
      )}
    </div>
  );
};

export default GooglePlacesInput;

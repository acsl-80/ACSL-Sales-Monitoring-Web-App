
import React from "react";
import { GoogleMap, Marker, LoadScript } from "@react-google-maps/api";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";

const MapPage = ({
  apiKey,
  locations = [],
  isFullscreen = false,
  mapType = "heatmap",
  intensity = "medium",
}) => {
  const [isLoading, setIsLoading] = React.useState(true);
  const [map, setMap] = React.useState(null);
  const overlayRef = React.useRef(null);

  // Enhanced map styling options
  const mapContainerStyle = {
    height: isFullscreen ? "100vh" : "100%",
    width: "100%",
  };

  // Heatmap intensity → deck.gl HeatmapLayer radius (pixels) & weight scaling.
  const intensitySettings = {
    low: { radius: 40, intensity: 1 },
    medium: { radius: 60, intensity: 1.5 },
    high: { radius: 90, intensity: 2 },
  };

  const currentIntensity =
    intensitySettings[intensity] || intensitySettings.medium;

  // Green → yellow → orange → red gradient (cool → hot), matching a classic
  // density heatmap. Colors are [r, g, b] with increasing alpha.
  const colorRange = [
    [0, 255, 0, 25],
    [120, 255, 0, 85],
    [200, 255, 0, 135],
    [255, 200, 0, 185],
    [255, 120, 0, 220],
    [255, 0, 0, 255],
  ];

  // Custom map styles for better visualization
  const mapStyles = [
    {
      featureType: "all",
      elementType: "geometry",
      stylers: [{ color: "#f5f5f5" }],
    },
    {
      featureType: "administrative",
      elementType: "labels.text.fill",
      stylers: [{ color: "#444444" }],
    },
    {
      featureType: "landscape",
      elementType: "all",
      stylers: [{ color: "#f2f2f2" }],
    },
    {
      featureType: "poi",
      elementType: "all",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "road",
      elementType: "all",
      stylers: [{ saturation: -100 }, { lightness: 45 }],
    },
    {
      featureType: "water",
      elementType: "all",
      stylers: [{ color: "#46bcec" }, { visibility: "on" }],
    },
  ];

  // Create/attach the deck.gl overlay once the map instance is ready.
  React.useEffect(() => {
    if (!map) return;
    const overlay = new GoogleMapsOverlay({ layers: [] });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => {
      overlay.setMap(null);
      overlayRef.current = null;
    };
  }, [map]);

  // Update the heatmap layer whenever data / settings change.
  React.useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    if (mapType !== "heatmap" || !locations.length) {
      overlay.setProps({ layers: [] });
      return;
    }

    const layer = new HeatmapLayer({
      id: "sales-heatmap",
      data: locations,
      getPosition: (d) => [parseFloat(d.lng), parseFloat(d.lat)],
      getWeight: (d) => Math.max(1, (d.amount || 0) / 50000),
      radiusPixels: currentIntensity.radius,
      intensity: currentIntensity.intensity,
      colorRange,
      aggregation: "SUM",
    });

    overlay.setProps({ layers: [layer] });
  }, [locations, mapType, currentIntensity.radius, currentIntensity.intensity]);

  return (
    <LoadScript googleMapsApiKey={apiKey} onLoad={() => setIsLoading(false)}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={{ lat: 9.082, lng: 8.6753 }}
        zoom={isFullscreen ? 6 : 6}
        mapTypeId="roadmap"
        onLoad={(m) => {
          setMap(m);
          // Always frame Nigeria by default.
          const nigeriaBounds = new google.maps.LatLngBounds(
            { lat: 4.0, lng: 2.6 }, // south-west
            { lat: 14.0, lng: 14.7 } // north-east
          );
          m.fitBounds(nigeriaBounds);
        }}
        onUnmount={() => setMap(null)}
        options={{
          disableDefaultUI: !isFullscreen,
          zoomControl: true,
          mapTypeControl: isFullscreen,
          scaleControl: true,
          streetViewControl: isFullscreen,
          rotateControl: false,
          fullscreenControl: isFullscreen,
          styles: mapStyles,
          gestureHandling: "greedy",
        }}
      >
        {!isLoading &&
          mapType === "markers" &&
          locations.slice(0, 200).map((location) => (
            <Marker
              key={location.id}
              position={{
                lat: parseFloat(location.lat),
                lng: parseFloat(location.lng),
              }}
              title={`${location.customerName} - ${location.city}, ${
                location.state
              }\nAmount: ₦${location.amount?.toLocaleString()}\nProduct: ${
                location.productCategory
              }`}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: Math.min(
                  Math.max(5, (location.amount || 0) / 25000),
                  20
                ), // Scale based on amount
                fillColor:
                  location.customerType === "Enterprise"
                    ? "#8B5CF6"
                    : location.customerType === "Premium"
                    ? "#3B82F6"
                    : location.customerType === "Standard"
                    ? "#10B981"
                    : "#F59E0B",
                fillOpacity: 0.8,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              }}
            />
          ))}
      </GoogleMap>
    </LoadScript>
  );
};

export default MapPage;

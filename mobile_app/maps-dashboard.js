/**
 * RoadShield AI - Dual-Engine Hazard Map Dashboard (Google Maps + Leaflet Fallback)
 * Renders real-time color-coded hazard markers from Firestore.
 * Automatically falls back to OpenStreetMap (Leaflet) if Google Maps Key is un-activated.
 */

let googleMap = null;
let leafletMap = null;
let mapMarkers = [];
let leafletMarkers = [];
let allHazardsData = [];
let activeEngine = "none"; // 'google' or 'leaflet'

const RISK_COLOR_HEX = {
    "CRITICAL": "#FF0044",
    "HIGH": "#FF7700",
    "MEDIUM": "#FFCC00",
    "LOW": "#00E676"
};

const RISK_MARKER_ICONS = {
    "CRITICAL": "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
    "HIGH": "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png",
    "MEDIUM": "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-yellow.png",
    "LOW": "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png"
};

/**
 * Main initialization entry point
 */
function loadGoogleMapsAPI(apiKey = "AIzaSyANWtKCnWMgeCOtbkd7YDfteEh0qJtlzE") {
    // Intercept Google Maps Auth Failure event (the "Oops! Something went wrong" popup)
    window.gm_authFailure = function() {
        console.warn("⚠️ Google Maps Auth Failed (Key requires Maps JS API activation). Switching to Leaflet OpenStreetMap...");
        initLeafletMap();
    };

    // If Leaflet is available, load OpenStreetMap directly for guaranteed keyless maps
    if (typeof L !== "undefined") {
        initLeafletMap();
        return;
    }

    if (window.google && window.google.maps) {
        initHazardMap();
        return;
    }
}

/**
 * Initializes Google Map
 */
window.initHazardMap = function () {
    const mapContainer = document.getElementById("google-map-container");
    if (!mapContainer) return;

    try {
        const loc = window.currentLocation || {};
        const defaultCenter = (loc.lat && loc.lng)
            ? { lat: loc.lat, lng: loc.lng }
            : { lat: 28.6139, lng: 77.2090 }; // Default India center

        googleMap = new google.maps.Map(mapContainer, {
            center: defaultCenter,
            zoom: 14,
            mapTypeId: 'roadmap',
            styles: [
                { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
                { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
                { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] }
            ]
        });

        activeEngine = "google";
        console.log("🗺️ Google Maps initialized.");
        subscribeToFirestoreHazards();
        setupMapFilters();
    } catch (e) {
        console.warn("Google Maps init exception, using Leaflet fallback:", e);
        initLeafletMap();
    }
};

/**
 * Fallback: Initializes Leaflet OpenStreetMap
 */
function initLeafletMap() {
    if (activeEngine === "leaflet") return;
    activeEngine = "leaflet";

    const mapContainer = document.getElementById("google-map-container");
    if (!mapContainer) return;

    mapContainer.innerHTML = ""; // Clear any previous error box
    const loc = window.currentLocation || {};
    const centerLat = (loc.lat) ? loc.lat : 28.6139;
    const centerLng = (loc.lng) ? loc.lng : 77.2090;

    leafletMap = L.map('google-map-container').setView([centerLat, centerLng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);

    console.log("🗺️ Leaflet OpenStreetMap Engine active.");
    subscribeToFirestoreHazards();
    setupMapFilters();
}

/**
 * Subscribes to real-time updates from Firestore hazards collection
 */
function subscribeToFirestoreHazards() {
    const dbInstance = window.getFirestoreDB();
    if (!dbInstance) {
        console.warn("Firestore database reference not available.");
        return;
    }

    dbInstance.collection("hazards").onSnapshot(snapshot => {
        allHazardsData = [];
        snapshot.forEach(doc => {
            allHazardsData.push({ id: doc.id, ...doc.data() });
        });
        console.log(`🗺️ Loaded ${allHazardsData.length} hazard records from Firestore.`);
        renderMarkers();
    }, err => {
        console.error("Firestore map subscription error:", err);
    });
}

/**
 * Clears and re-renders markers according to filter selections
 */
function renderMarkers() {
    const filterClass = document.getElementById("filter-map-class")?.value || "all";
    const filterLevel = document.getElementById("filter-map-level")?.value || "all";

    const filteredHazards = allHazardsData.filter(item => {
        const matchClass = (filterClass === "all" || item.class_name === filterClass);
        const matchLevel = (filterLevel === "all" || item.risk_level === filterLevel);
        return matchClass && matchLevel;
    });

    const markerCountElem = document.getElementById("map-marker-count");
    if (markerCountElem) markerCountElem.textContent = filteredHazards.length;

    if (activeEngine === "google" && googleMap) {
        renderGoogleMarkers(filteredHazards);
    } else if (activeEngine === "leaflet" && leafletMap) {
        renderLeafletMarkers(filteredHazards);
    }
}

function renderGoogleMarkers(hazards) {
    mapMarkers.forEach(m => m.setMap(null));
    mapMarkers = [];
    const infoWindow = new google.maps.InfoWindow();

    hazards.forEach(hazard => {
        if (!hazard.latitude || !hazard.longitude) return;

        const marker = new google.maps.Marker({
            position: { lat: hazard.latitude, lng: hazard.longitude },
            map: googleMap,
            title: `${hazard.class_name} (${hazard.risk_level})`
        });

        marker.addListener("click", () => {
            infoWindow.setContent(createPopupHTML(hazard));
            infoWindow.open(googleMap, marker);
        });

        mapMarkers.push(marker);
    });
}

function renderLeafletMarkers(hazards) {
    leafletMarkers.forEach(m => leafletMap.removeLayer(m));
    leafletMarkers = [];

    hazards.forEach(hazard => {
        // If latitude/longitude is missing (e.g. PC testing without GPS), use a default offset for demo view
        const lat = hazard.latitude || 28.6139;
        const lng = hazard.longitude || 77.2090;

        const iconUrl = RISK_MARKER_ICONS[hazard.risk_level] || RISK_MARKER_ICONS["LOW"];
        const customIcon = L.icon({
            iconUrl: iconUrl,
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(leafletMap);
        marker.bindPopup(createPopupHTML(hazard));
        leafletMarkers.push(marker);
    });
}

function createPopupHTML(hazard) {
    const firstSeenFormatted = hazard.first_seen ? new Date(hazard.first_seen).toLocaleString() : 'N/A';
    const lastSeenFormatted = hazard.last_seen ? new Date(hazard.last_seen).toLocaleString() : 'N/A';

    return `
        <div class="map-popup-card">
            <h4 style="margin:0 0 6px 0; color:#111; text-transform:uppercase;">⚠️ ${hazard.class_name.replace('_', ' ')}</h4>
            <p style="margin:2px 0; font-size:12px; color:#111;"><strong>Risk Level:</strong> <span class="badge-${hazard.risk_level.toLowerCase()}">${hazard.risk_level}</span> (${hazard.risk_score})</p>
            <p style="margin:2px 0; font-size:12px; color:#111;"><strong>Confidence:</strong> ${((hazard.confidence || 0) * 100).toFixed(1)}%</p>
            <p style="margin:2px 0; font-size:12px; color:#111;"><strong>Times Detected:</strong> ${hazard.times_detected || 1}</p>
            <p style="margin:2px 0; font-size:11px; color:#666;"><strong>First Seen:</strong> ${firstSeenFormatted}</p>
            <p style="margin:2px 0; font-size:11px; color:#666;"><strong>Last Seen:</strong> ${lastSeenFormatted}</p>
        </div>
    `;
}

/**
 * Binds dropdown change events for map filters
 */
function setupMapFilters() {
    const classFilter = document.getElementById("filter-map-class");
    const levelFilter = document.getElementById("filter-map-level");

    if (classFilter) classFilter.addEventListener("change", renderMarkers);
    if (levelFilter) levelFilter.addEventListener("change", renderMarkers);
}

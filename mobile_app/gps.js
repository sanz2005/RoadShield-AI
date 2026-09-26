/**
 * RoadShield AI - Continuous GPS Tracking Module
 * Uses navigator.geolocation.watchPosition to maintain live lat/lng coordinates.
 * Exposes window.currentLocation state for AI detection logger and map UI.
 */

window.currentLocation = {
    lat: null,
    lng: null,
    accuracy: null,
    timestamp: null,
    error: null,
    isAvailable: false
};

let watchId = null;

/**
 * Initializes continuous geolocation monitoring
 */
function initGPSTracking() {
    if (!("geolocation" in navigator)) {
        const errMsg = "Geolocation is not supported by this browser/device.";
        console.warn("⚠️ " + errMsg);
        window.currentLocation.error = errMsg;
        updateGPSUI(false, "GPS Unsupported");
        return;
    }

    const options = {
        enableHighAccuracy: true, // High accuracy GPS sensor
        timeout: 15000,           // Max wait 15s per update
        maximumAge: 0             // Do not use cached position
    };

    console.log("📡 Initializing continuous GPS watch tracking...");

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const coords = position.coords;
            window.currentLocation = {
                lat: coords.latitude,
                lng: coords.longitude,
                accuracy: coords.accuracy,
                timestamp: new Date(position.timestamp).toISOString(),
                error: null,
                isAvailable: true
            };

            const accRounded = Math.round(coords.accuracy);
            updateGPSUI(true, `GPS Active (±${accRounded}m)`);
        },
        (err) => {
            let errorText = "GPS Position Error";
            switch (err.code) {
                case err.PERMISSION_DENIED:
                    errorText = "GPS Permission Denied";
                    break;
                case err.POSITION_UNAVAILABLE:
                    errorText = "GPS Signal Unavailable";
                    break;
                case err.TIMEOUT:
                    errorText = "GPS Request Timeout";
                    break;
            }
            console.warn(`⚠️ Geolocation Watch Warning (${err.code}): ${err.message}`);
            window.currentLocation.error = errorText;
            window.currentLocation.isAvailable = false;
            updateGPSUI(false, errorText);
        },
        options
    );
}

/**
 * Updates the GPS status indicator in the top header HUD
 */
function updateGPSUI(active, labelText) {
    const statusPill = document.getElementById("gps-status-pill");
    if (!statusPill) return;

    if (active) {
        statusPill.className = "metric-pill gps-pill active";
        statusPill.innerHTML = `📡 <span id="gps-coords-text">${labelText}</span>`;
    } else {
        statusPill.className = "metric-pill gps-pill disabled";
        statusPill.innerHTML = `⚠️ <span id="gps-coords-text">${labelText}</span>`;
    }
}

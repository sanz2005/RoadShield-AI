/**
 * RoadShield AI - Hazard Logging & Location-Based Deduplication Module
 * Logs newly tracked hazards to Firestore with 15-20m spatial deduplication
 * and supports offline queueing when network connection is lost.
 */

const DEDUPLICATION_RADIUS_METERS = 18.0;
const HAZARD_COLLECTION = "hazards";

// Default coordinates if testing on device/PC where GPS signal is not active
const DEFAULT_FALLBACK_LAT = 28.6139;
const DEFAULT_FALLBACK_LNG = 77.2090;

// Generate or retrieve persistent unique session ID for this device instance
function getSessionId() {
    let sid = localStorage.getItem("roadshield_session_id");
    if (!sid) {
        sid = "sess_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
        localStorage.setItem("roadshield_session_id", sid);
    }
    return sid;
}

/**
 * Displays floating UI Toast Notifications on bottom right of screen
 */
function showToast(message, type = "success") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.cssText = "position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:8px;";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.style.cssText = `
        background: ${type === 'success' ? 'rgba(0, 230, 118, 0.95)' : (type === 'warning' ? 'rgba(255, 170, 0, 0.95)' : 'rgba(255, 0, 68, 0.95)')};
        color: #000;
        padding: 10px 16px;
        border-radius: 8px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.8rem;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        transition: all 0.3s ease;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * Calculates Haversine distance in meters between two lat/lng points
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return Infinity;
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Primary entry point: Called from live AI detection loop in app.js
 * Processes tracked detection results and logs NEW hazards only.
 */
async function logTrackedHazards(trackedResults) {
    if (!trackedResults || !trackedResults.length) return;

    // Filter only new hazard tracks (isNew === true)
    const newHazards = trackedResults.filter(det => det.isNew === true);
    if (!newHazards.length) return;

    const loc = window.currentLocation || {};
    // Use live GPS coordinates if available, otherwise use default fallback coords for testing
    const lat = (loc.lat !== null && loc.lat !== undefined) ? loc.lat : DEFAULT_FALLBACK_LAT;
    const lng = (loc.lng !== null && loc.lng !== undefined) ? loc.lng : DEFAULT_FALLBACK_LNG;

    for (const det of newHazards) {
        const confVal = (det.conf !== undefined) ? det.conf : (det.confidence !== undefined ? det.confidence : 0.0);
        const hazardPayload = {
            class_name: det.className,
            confidence: parseFloat(confVal.toFixed(3)),
            risk_score: parseFloat(det.riskScore.toFixed(2)),
            risk_level: det.riskLevel,
            latitude: lat,
            longitude: lng,
            timestamp: new Date().toISOString(),
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            times_detected: 1,
            session_id: getSessionId(),
            track_id: det.trackId
        };

        console.log(`⚡ Processing Hazard Track #${det.trackId}: ${det.className} (${det.riskLevel}, Risk: ${det.riskScore})`);

        if (navigator.onLine && window.getFirestoreDB()) {
            await processDatabaseLogging(hazardPayload);
        } else {
            queueOfflineHazard(hazardPayload);
        }
    }
}

/**
 * Deduplicates and logs/updates hazard in Firestore
 */
async function processDatabaseLogging(payload) {
    const dbInstance = window.getFirestoreDB();
    if (!dbInstance) {
        queueOfflineHazard(payload);
        return;
    }

    try {
        let nearbyMatchDoc = null;
        let minDistance = Infinity;

        // Query existing hazards of the same class
        if (payload.latitude !== null && payload.longitude !== null) {
            const snapshot = await dbInstance.collection(HAZARD_COLLECTION)
                .where("class_name", "==", payload.class_name)
                .get();

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.latitude && data.longitude) {
                    const dist = haversineDistanceMeters(payload.latitude, payload.longitude, data.latitude, data.longitude);
                    if (dist <= DEDUPLICATION_RADIUS_METERS && dist < minDistance) {
                        minDistance = dist;
                        nearbyMatchDoc = doc;
                    }
                }
            });
        }

        if (nearbyMatchDoc) {
            // Existing spatial match found within 18m -> Update existing entry
            const existingData = nearbyMatchDoc.data();
            const newTimesDetected = (existingData.times_detected || 1) + 1;
            const updatedRiskScore = Math.max(existingData.risk_score || 0, payload.risk_score);

            await dbInstance.collection(HAZARD_COLLECTION).doc(nearbyMatchDoc.id).update({
                times_detected: newTimesDetected,
                last_seen: payload.timestamp,
                risk_score: updatedRiskScore,
                risk_level: updatedRiskScore >= 7.5 ? "CRITICAL" : (updatedRiskScore >= 5.0 ? "HIGH" : (updatedRiskScore >= 2.5 ? "MEDIUM" : "LOW"))
            });

            console.log(`🔄 Deduplicated existing ${payload.class_name} at ${minDistance.toFixed(1)}m. Count: ${newTimesDetected}`);
            showToast(`🔄 Updated ${payload.class_name.replace('_', ' ')} (${newTimesDetected}x)`, "warning");
        } else {
            // No match within 18m -> Create new hazard entry
            const docRef = await dbInstance.collection(HAZARD_COLLECTION).add(payload);
            console.log(`✅ Logged NEW hazard doc to Firestore [ID: ${docRef.id}]`);
            showToast(`🔥 Logged to Firestore: ${payload.class_name.replace('_', ' ')} (${payload.risk_level})`, "success");
        }
    } catch (err) {
        console.error("❌ Firestore write failed:", err.message);
        
        if (err.message && err.message.includes("database")) {
            showToast("⚠️ Firebase Console error: Firestore Database not enabled yet", "error");
        } else {
            showToast(`⚠️ DB Error: Saved to local offline queue`, "warning");
        }
        
        queueOfflineHazard(payload);
    }
}

/**
 * Stores un-synced hazard detection payloads in localStorage
 */
function queueOfflineHazard(payload) {
    try {
        const queueRaw = localStorage.getItem("hazard_offline_queue") || "[]";
        const queue = JSON.parse(queueRaw);
        queue.push(payload);
        localStorage.setItem("hazard_offline_queue", JSON.stringify(queue));
        console.log(`💾 Queued hazard offline (Total queued: ${queue.length})`);
        showToast(`💾 Offline Queued: ${payload.class_name.replace('_', ' ')}`, "warning");
    } catch (e) {
        console.error("Failed to queue hazard offline:", e);
    }
}

/**
 * Flushes offline queued hazards to Firestore when network connectivity is restored
 */
async function syncOfflineQueue() {
    if (!navigator.onLine) return;
    const dbInstance = window.getFirestoreDB();
    if (!dbInstance) return;

    const queueRaw = localStorage.getItem("hazard_offline_queue");
    if (!queueRaw) return;

    try {
        const queue = JSON.parse(queueRaw);
        if (!queue.length) return;

        console.log(`🌐 Syncing ${queue.length} offline hazards to Firestore...`);
        localStorage.removeItem("hazard_offline_queue");

        for (const item of queue) {
            await processDatabaseLogging(item);
        }
        showToast(`✅ Synced ${queue.length} queued hazards to Firestore`, "success");
    } catch (err) {
        console.error("Error syncing offline queue:", err);
    }
}

// Register online connectivity restore listener
window.addEventListener("online", () => {
    syncOfflineQueue();
});

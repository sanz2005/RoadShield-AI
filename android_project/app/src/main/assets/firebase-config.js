/**
 * RoadShield AI - Firebase & Firestore Configuration
 * Initializes Firebase Web SDK (compat mode for non-bundled browser JS)
 * Enables offline IndexedDB persistence for seamless offline hazard queuing.
 */

// Firebase Configuration Object (Replace with your actual Firebase Project credentials if available)
const firebaseConfig = {
    apiKey: "AIzaSyAuXiJXmY2b1ZxrevFO-m-HvImYgqZAhWg",
    authDomain: "roadshield-ai.firebaseapp.com",
    projectId: "roadshield-ai",
    storageBucket: "roadshield-ai.firebasestorage.app",
    messagingSenderId: "394771137920",
    appId: "1:394771137920:web:c6f5df9f120e3e7cf2ed65"
};

let db = null;
let firebaseInitialized = false;

function initFirebase() {
    if (typeof firebase === "undefined") {
        console.warn("⚠️ Firebase SDK not loaded in HTML scripts. Running in offline/demo local storage mode.");
        return null;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("🔥 Firebase App initialized successfully.");
        }

        db = firebase.firestore();

        // Enable offline persistence in browser/WebView
        db.enablePersistence({ synchronizeTabs: true })
            .then(() => console.log("💾 Firestore offline persistence enabled."))
            .catch((err) => {
                if (err.code === 'failed-precondition') {
                    console.warn("Multiple tabs open, persistence enabled in first tab only.");
                } else if (err.code === 'unimplemented') {
                    console.warn("Browser does not support offline persistence.");
                }
            });

        firebaseInitialized = true;
        return db;
    } catch (err) {
        console.error("❌ Firebase initialization failed:", err);
        return null;
    }
}

// Global accessor for Firestore database instance
window.getFirestoreDB = function () {
    if (!db && typeof firebase !== "undefined") {
        return initFirebase();
    }
    return db;
};

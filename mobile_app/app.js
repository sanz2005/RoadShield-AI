/**
 * RoadShield AI Mobile Application Controller
 * Handles ONNX Runtime Web model loading, camera/video feed, tensor pre-processing,
 * post-processing, RiskScorer & HazardTracker invocation, and HUD UI rendering.
 */

// Class names matching PyTorch model training order
const CLASS_NAMES = ["open_manhole", "manhole", "pothole", "crack", "debris", "speed_bump", "unmarked_bump"];

const CLASS_COLORS = {
    0: "rgb(255, 0, 0)",       // open_manhole - Red
    1: "rgb(255, 165, 0)",     // manhole - Orange
    2: "rgb(255, 255, 0)",     // pothole - Yellow
    3: "rgb(0, 100, 255)",     // crack - Blue
    4: "rgb(255, 0, 255)",     // debris - Magenta
    5: "rgb(0, 255, 0)",       // speed_bump - Green
    6: "rgb(0, 255, 255)"      // unmarked_bump - Cyan
};

const RISK_LEVEL_COLORS = {
    "CRITICAL": "rgb(255, 0, 68)",
    "HIGH": "rgb(255, 119, 0)",
    "MEDIUM": "rgb(255, 204, 0)",
    "LOW": "rgb(0, 230, 118)"
};

let ortSession = null;
let riskScorer = new RiskScorer(640, 640);
let hazardTracker = new HazardTracker(0.3, 15);

let confThreshold = 0.25; // Default conf matching Python inference.py
let iouThreshold = 0.30;
let audioEnabled = true;

let isWebcamRunning = false;
let currentFacingMode = "environment";
let webcamStream = null;
let animFrameId = null;

let availableCameras = [];
let selectedDeviceId = "";

let isProcessingVideo = false;
let videoProcessingStop = false;

// Audio context synthesizer for risk beep alerts
let audioCtx = null;

const sessionStats = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    classCounts: {
        open_manhole: 0,
        manhole: 0,
        pothole: 0,
        crack: 0,
        debris: 0,
        speed_bump: 0,
        unmarked_bump: 0
    },
    alertsLog: []
};

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
    configureONNXRuntime();
    initNavigation();
    initSettings();
    initAudio();

    // Initialize GPS tracking & Cloud Database
    if (typeof initGPSTracking === "function") initGPSTracking();
    if (typeof initFirebase === "function") initFirebase();

    await loadOnnxModel();
    setupEventListeners();
    await updateCameraList();
});

function configureONNXRuntime() {
    if (window.ort) {
        ort.env.wasm.wasmPaths = "./";
        ort.env.wasm.numThreads = 2;
        console.log("⚙️ Local ONNX WASM environment paths set to ./");
    }
}

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn("AudioContext not supported");
    }
}

function playBeep(freq = 880, duration = 0.15) {
    if (!audioEnabled || !audioCtx) return;
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Audio beep failed:", e);
    }
}

async function loadOnnxModel() {
    const statusBadge = document.getElementById("model-status");
    try {
        statusBadge.textContent = "Loading ONNX AI...";
        statusBadge.className = "status-badge loading";

        const candidatePaths = [
            "assets/best.onnx",
            "./assets/best.onnx",
            "best.onnx",
            "https://appassets.androidplatform.net/assets/assets/best.onnx",
            "https://appassets.androidplatform.net/assets/best.onnx"
        ];

        let loaded = false;
        let lastErr = null;

        for (const path of candidatePaths) {
            try {
                console.log(`Trying ONNX path: ${path}`);
                ortSession = await ort.InferenceSession.create(path, {
                    executionProviders: ['wasm'],
                    graphOptimizationLevel: 'all'
                });
                console.log(`✅ Loaded ONNX model from: ${path}`);
                loaded = true;
                break;
            } catch (e) {
                lastErr = e;
                console.warn(`Failed path ${path}:`, e ? (e.message || e) : e);
            }
        }

        if (loaded && ortSession) {
            statusBadge.textContent = "AI Engine Active ✓";
            statusBadge.className = "status-badge ready";
        } else {
            throw lastErr || new Error("Could not load best.onnx from any asset path");
        }
    } catch (err) {
        console.error("ONNX Model load error:", err);
        statusBadge.textContent = "Model Load Failed ❌";
        statusBadge.className = "status-badge loading";
    }
}

// Sample Image Suite
const SAMPLE_IMAGES = [
    "samples/open_manholes_dedicated_14_jpg.rf.a57eeedede9c1a4c060ae07d4d608c20.jpg",
    "samples/open_manholes_dedicated_2-open-manhole-cover-with-cones-D77DHK_jpg.rf.480a9a62fabb4888580257209a3361aa.jpg",
    "samples/open_manholes_dedicated_21_jpg.rf.3389a65f0e8e72f0b39ef15eae8384ae.jpg",
    "samples/open_manholes_dedicated_23DD8D1700000578-2864879-image-m-83_1418014874671_jpg.rf.e84303f5d3baa7fed299a05a5250cb5c.jpg",
    "samples/open_manholes_dedicated_240_jpg.rf.61d74d43a08cea8259cac8f6327973f0.jpg",
    "samples/open_manholes_dedicated_257_jpg.rf.e0fa04cd3ed5dfa736636f9580e4f6d1.jpg",
    "samples/open_manholes_dedicated_264_jpg.rf.e6e76d0770209732f3e560fe6c89e202.jpg",
    "samples/open_manholes_dedicated_306_jpg.rf.d3cfe132c3fdf1a459a2525b549e82a5.jpg"
];

function initSampleGrid() {
    const grid = document.getElementById("sample-grid");
    if (!grid) return;
    grid.innerHTML = SAMPLE_IMAGES.map((path, idx) => `
        <img class="sample-thumb" src="${path}" title="Sample ${idx+1}" data-idx="${idx}">
    `).join("");

    grid.querySelectorAll(".sample-thumb").forEach(thumb => {
        thumb.addEventListener("click", () => {
            grid.querySelectorAll(".sample-thumb").forEach(t => t.classList.remove("selected"));
            thumb.classList.add("selected");
            const img = new Image();
            img.onload = () => runOnImage(img);
            img.src = thumb.src;
        });
    });
}

// Navigation Tabs
function initNavigation() {
    const tabs = document.querySelectorAll(".nav-tab");
    const panels = document.querySelectorAll(".view-panel");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));

            tab.classList.add("active");
            const mode = tab.dataset.mode;
            document.getElementById(`view-${mode}`).classList.add("active");

            // Pause webcam if switching away from dashcam mode
            if (mode !== "dashcam" && isWebcamRunning) {
                pauseWebcam();
            }

            // Load Google Maps API when switching to map tab
            if (mode === "map" && typeof loadGoogleMapsAPI === "function") {
                loadGoogleMapsAPI();
            }
        });
    });
}

// Settings Drawer
function initSettings() {
    const btnSettings = document.getElementById("btn-settings");
    const btnClose = document.getElementById("btn-close-settings");
    const modal = document.getElementById("modal-settings");

    const sliderConf = document.getElementById("slider-conf");
    const valConf = document.getElementById("val-conf");
    const sliderIou = document.getElementById("slider-iou");
    const valIou = document.getElementById("val-iou");
    const chkAudio = document.getElementById("chk-audio");

    sliderConf.value = confThreshold;
    valConf.textContent = confThreshold.toFixed(2);

    btnSettings.addEventListener("click", () => modal.classList.add("active"));
    btnClose.addEventListener("click", () => modal.classList.remove("active"));

    sliderConf.addEventListener("input", (e) => {
        confThreshold = parseFloat(e.target.value);
        valConf.textContent = confThreshold.toFixed(2);
    });

    sliderIou.addEventListener("input", (e) => {
        iouThreshold = parseFloat(e.target.value);
        valIou.textContent = iouThreshold.toFixed(2);
        hazardTracker.iouThreshold = iouThreshold;
    });

    chkAudio.addEventListener("change", (e) => {
        audioEnabled = e.target.checked;
    });
}

// Event Listeners for Buttons & File Pickers
function setupEventListeners() {
    const btnStartCamera = document.getElementById("btn-start-camera");
    const btnToggleCamera = document.getElementById("btn-toggle-camera");
    const btnPauseCamera = document.getElementById("btn-pause-camera");

    btnStartCamera.addEventListener("click", startWebcam);
    btnToggleCamera.addEventListener("click", toggleCameraFacing);
    btnPauseCamera.addEventListener("click", pauseWebcam);

    const inputVideoFile = document.getElementById("input-video-file");
    const btnProcessVideo = document.getElementById("btn-process-video");
    const btnStopVideo = document.getElementById("btn-stop-video");
    const videoElem = document.getElementById("file-video");

    inputVideoFile.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            videoElem.src = URL.createObjectURL(file);
            btnProcessVideo.disabled = false;
        }
    });

    btnProcessVideo.addEventListener("click", () => processVideo(videoElem));
    btnStopVideo.addEventListener("click", () => { videoProcessingStop = true; });

    const inputImageFile = document.getElementById("input-image-file");
    inputImageFile.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const img = new Image();
            img.onload = () => runOnImage(img);
            img.src = URL.createObjectURL(file);
        }
    });

    const mainSelect = document.getElementById("camera-select");
    const modalSelect = document.getElementById("modal-camera-select");

    const onCameraSelectChange = (e) => {
        selectedDeviceId = e.target.value;
        if (mainSelect) mainSelect.value = selectedDeviceId;
        if (modalSelect) modalSelect.value = selectedDeviceId;
        if (isWebcamRunning) {
            startWebcam();
        }
    };

    if (mainSelect) mainSelect.addEventListener("change", onCameraSelectChange);
    if (modalSelect) modalSelect.addEventListener("change", onCameraSelectChange);

    if (navigator.mediaDevices && navigator.mediaDevices.ondevicechange !== undefined) {
        navigator.mediaDevices.ondevicechange = () => updateCameraList();
    }

    document.getElementById("btn-export-log").addEventListener("click", exportLogJSON);
}

// Enumerate and populate all connected camera devices (Front/Rear Dashcams, Mobile Cams, USB Cams)
async function updateCameraList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        availableCameras = videoDevices;

        const mainSelect = document.getElementById("camera-select");
        const modalSelect = document.getElementById("modal-camera-select");

        let optionsHtml = "";
        if (videoDevices.length === 0) {
            optionsHtml = '<option value="">No Camera Detected</option>';
        } else {
            videoDevices.forEach((device, index) => {
                let rawLabel = device.label || "";
                let label = rawLabel;
                const lower = rawLabel.toLowerCase();
                let icon = "📹";

                if (lower.includes("back") || lower.includes("rear") || lower.includes("environment")) {
                    icon = "🚗";
                    if (!label) label = `Dashcam Rear / Back Camera ${index + 1}`;
                } else if (lower.includes("front") || lower.includes("user") || lower.includes("selfie")) {
                    icon = "🚘";
                    if (!label) label = `Dashcam Front / Interior Camera ${index + 1}`;
                } else if (lower.includes("usb") || lower.includes("external")) {
                    icon = "📹";
                    if (!label) label = `External USB Dashcam ${index + 1}`;
                } else {
                    if (!label) label = `Camera Source ${index + 1}`;
                }

                const isSel = selectedDeviceId ? (device.deviceId === selectedDeviceId) : (index === 0);
                optionsHtml += `<option value="${device.deviceId}" ${isSel ? "selected" : ""}>${icon} ${label}</option>`;
            });
        }

        if (mainSelect) mainSelect.innerHTML = optionsHtml;
        if (modalSelect) modalSelect.innerHTML = optionsHtml;

        if (!selectedDeviceId && videoDevices.length > 0) {
            selectedDeviceId = videoDevices[0].deviceId;
            if (mainSelect) mainSelect.value = selectedDeviceId;
            if (modalSelect) modalSelect.value = selectedDeviceId;
        }
    } catch (err) {
        console.warn("Error enumerating cameras:", err);
    }
}

// Dashcam Live Camera Stream
async function startWebcam() {
    const placeholder = document.getElementById("camera-placeholder");
    const video = document.getElementById("webcam-video");
    const btnToggle = document.getElementById("btn-toggle-camera");
    const btnPause = document.getElementById("btn-pause-camera");

    try {
        if (webcamStream) {
            webcamStream.getTracks().forEach(t => t.stop());
        }

        let videoConstraints = {
            width: { ideal: 1280 },
            height: { ideal: 720 }
        };

        if (selectedDeviceId) {
            videoConstraints.deviceId = { exact: selectedDeviceId };
        } else {
            videoConstraints.facingMode = currentFacingMode;
        }

        try {
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: false
            });
        } catch (constraintErr) {
            console.warn("Exact deviceId constraint failed, falling back to basic constraints:", constraintErr);
            const fallbackConstraints = {
                video: selectedDeviceId ? { deviceId: selectedDeviceId } : { facingMode: currentFacingMode },
                audio: false
            };
            webcamStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        }

        video.srcObject = webcamStream;
        await video.play();

        placeholder.style.display = "none";
        btnToggle.disabled = false;
        btnPause.disabled = false;
        isWebcamRunning = true;

        const activeTrack = webcamStream.getVideoTracks()[0];
        if (activeTrack) {
            const settings = activeTrack.getSettings();
            if (settings.deviceId) {
                selectedDeviceId = settings.deviceId;
            }
        }

        await updateCameraList();

        hazardTracker.reset();
        lastTime = performance.now();
        frameCount = 0;
        runDashcamLoop();
    } catch (err) {
        console.error("Camera access error:", err);
        alert("Camera access denied or unavailable. Please grant camera permissions in device settings.");
    }
}

function toggleCameraFacing() {
    if (availableCameras.length > 1) {
        const currentIndex = availableCameras.findIndex(d => d.deviceId === selectedDeviceId);
        const nextIndex = (currentIndex + 1) % availableCameras.length;
        selectedDeviceId = availableCameras[nextIndex].deviceId;

        const mainSelect = document.getElementById("camera-select");
        const modalSelect = document.getElementById("modal-camera-select");
        if (mainSelect) mainSelect.value = selectedDeviceId;
        if (modalSelect) modalSelect.value = selectedDeviceId;

        startWebcam();
    } else {
        currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
        selectedDeviceId = "";
        startWebcam();
    }
}

function pauseWebcam() {
    isWebcamRunning = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }

    document.getElementById("camera-placeholder").style.display = "flex";
    document.getElementById("btn-toggle-camera").disabled = true;
    document.getElementById("btn-pause-camera").disabled = true;
}

let lastTime = performance.now();
let frameCount = 0;

async function runDashcamLoop() {
    if (!isWebcamRunning) return;

    const video = document.getElementById("webcam-video");
    const canvas = document.getElementById("dashcam-canvas");

    if (video.readyState >= 2) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        riskScorer.setDimensions(canvas.width, canvas.height);
        const rawDetections = await detectFrame(video);
        const trackedResults = hazardTracker.update(rawDetections);

        // Log tracked hazards to Firestore database with spatial deduplication
        if (typeof logTrackedHazards === "function") {
            logTrackedHazards(trackedResults);
        }

        renderDetections(canvas, video, trackedResults);
        updateDashcamHUD(trackedResults);

        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            document.getElementById("fps-counter").textContent = frameCount;
            frameCount = 0;
            lastTime = now;
        }
    }

    animFrameId = requestAnimationFrame(runDashcamLoop);
}

// Model Tensor Pre-Processing & Post-Processing
async function detectFrame(imageOrVideo) {
    if (!ortSession) {
        return [];
    }

    const origW = imageOrVideo.videoWidth || imageOrVideo.naturalWidth || imageOrVideo.width || 640;
    const origH = imageOrVideo.videoHeight || imageOrVideo.naturalHeight || imageOrVideo.height || 640;

    const inputCanvas = document.createElement("canvas");
    inputCanvas.width = 640;
    inputCanvas.height = 640;
    const ctx = inputCanvas.getContext("2d");
    ctx.drawImage(imageOrVideo, 0, 0, 640, 640);
    const imgData = ctx.getImageData(0, 0, 640, 640);

    const float32Data = new Float32Array(3 * 640 * 640);
    const data = imgData.data;

    // Normalization to BCHW Float32 [1, 3, 640, 640]
    for (let i = 0; i < 640 * 640; i++) {
        float32Data[i] = data[i * 4] / 255.0;                      // R
        float32Data[640 * 640 + i] = data[i * 4 + 1] / 255.0;        // G
        float32Data[2 * 640 * 640 + i] = data[i * 4 + 2] / 255.0;    // B
    }

    const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, 640, 640]);

    try {
        const outputs = await ortSession.run({ [ortSession.inputNames[0]]: inputTensor });
        const outputTensor = outputs[ortSession.outputNames[0]]; // shape [1, 11, 8400]
        
        return parseYOLOOutputs(outputTensor.data, origW, origH);
    } catch (e) {
        console.error("Inference execution error:", e);
        return [];
    }
}

function parseYOLOOutputs(data, origWidth, origHeight) {
    const rawDetections = [];
    const numAnchors = 8400;
    const numClasses = 7;

    for (let i = 0; i < numAnchors; i++) {
        let maxScore = 0;
        let maxClassId = -1;

        for (let c = 0; c < numClasses; c++) {
            const score = data[(4 + c) * numAnchors + i];
            if (score > maxScore) {
                maxScore = score;
                maxClassId = c;
            }
        }

        if (maxScore >= confThreshold) {
            const cx = data[0 * numAnchors + i] * (origWidth / 640);
            const cy = data[1 * numAnchors + i] * (origHeight / 640); // Fixed Y scaling
            const w = data[2 * numAnchors + i] * (origWidth / 640);
            const h = data[3 * numAnchors + i] * (origHeight / 640);

            const x1 = Math.round(cx - w / 2);
            const y1 = Math.round(cy - h / 2);
            const x2 = Math.round(cx + w / 2);
            const y2 = Math.round(cy + h / 2);

            const className = CLASS_NAMES[maxClassId];
            const riskResult = riskScorer.computeRisk(className, maxScore, x1, y1, x2, y2);

            rawDetections.push({
                className: className,
                classId: maxClassId,
                box: [x1, y1, x2, y2],
                conf: maxScore,
                riskScore: riskResult.risk_score,
                riskLevel: riskResult.risk_level,
                riskResult: riskResult
            });
        }
    }

    // Apply Non-Maximum Suppression (NMS)
    return nms(rawDetections, 0.45);
}

function nms(detections, iouThresh) {
    detections.sort((a, b) => b.conf - a.conf);
    const selected = [];
    const active = new Array(detections.length).fill(true);

    for (let i = 0; i < detections.length; i++) {
        if (!active[i]) continue;
        selected.push(detections[i]);

        for (let j = i + 1; j < detections.length; j++) {
            if (!active[j]) continue;
            if (HazardTracker.iou(detections[i].box, detections[j].box) > iouThresh) {
                active[j] = false;
            }
        }
    }

    return selected;
}

// Rendering Overlay Box matching Python draw_detection()
function renderDetections(canvas, imageOrVideo, trackedResults) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If imageOrVideo is an HTMLImageElement (e.g. Test Suite custom upload or sample image), draw the image onto canvas first!
    if (imageOrVideo && (imageOrVideo instanceof HTMLImageElement || imageOrVideo.tagName === "IMG")) {
        ctx.drawImage(imageOrVideo, 0, 0, canvas.width, canvas.height);
    }

    for (const t of trackedResults) {
        const [x1, y1, x2, y2] = t.box;
        const boxColor = CLASS_COLORS[t.classId] || "rgb(255, 255, 255)";

        // 1. Draw Bounding Box
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // 2. Prepare Labels
        const idTag = t.trackId ? `#${t.trackId} ` : "";
        const newTag = t.isNew ? " [NEW]" : "";
        const label = `${idTag}${t.className} ${t.conf.toFixed(2)}${newTag}`;
        const riskLabel = `Risk: ${t.riskScore.toFixed(1)} (${t.riskLevel})`;

        const riskColor = RISK_LEVEL_COLORS[t.riskLevel] || "rgb(255, 255, 255)";

        ctx.font = "bold 13px 'JetBrains Mono', monospace";
        const w1 = ctx.measureText(label).width;
        const w2 = ctx.measureText(riskLabel).width;
        const maxW = Math.max(w1, w2);

        const textY = Math.max(y1 - 36, 0);

        // Label Tag Background Box
        ctx.fillStyle = boxColor;
        ctx.fillRect(x1, textY, maxW + 12, 36);

        // Label Texts
        ctx.fillStyle = "#000000";
        ctx.fillText(label, x1 + 6, textY + 14);

        ctx.fillStyle = riskColor;
        ctx.fillText(riskLabel, x1 + 6, textY + 30);
    }
}

// Update HUD & Stats
function updateDashcamHUD(trackedResults) {
    document.getElementById("active-hazard-count").textContent = trackedResults.length;

    let maxRisk = "SAFE";
    let highestScore = -1;

    for (const t of trackedResults) {
        if (t.riskScore > highestScore) {
            highestScore = t.riskScore;
            maxRisk = t.riskLevel;
        }

        if (t.isNew) {
            addAlertLog(t);
            recordSessionStats(t);
            if (t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH") {
                playBeep(1200, 0.25);
            }
        }
    }

    const badge = document.getElementById("max-risk-badge");
    badge.textContent = maxRisk;
    badge.className = `metric-pill risk-pill ${maxRisk}`;
}

function addAlertLog(t) {
    const list = document.getElementById("live-alerts-list");
    const emptyMsg = list.querySelector(".alert-empty");
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement("div");
    item.className = `alert-item ${t.riskLevel}`;
    const timestamp = new Date().toLocaleTimeString();
    item.innerHTML = `
        <span>[${timestamp}] #${t.trackId} <strong>${t.className}</strong></span>
        <span>Risk: ${t.riskScore.toFixed(1)} (${t.riskLevel})</span>
    `;

    list.prepend(item);
    if (list.children.length > 50) {
        list.lastChild.remove();
    }
}

function recordSessionStats(t) {
    if (t.riskLevel === "CRITICAL") sessionStats.critical++;
    else if (t.riskLevel === "HIGH") sessionStats.high++;
    else if (t.riskLevel === "MEDIUM") sessionStats.medium++;
    else sessionStats.low++;

    if (sessionStats.classCounts[t.className] !== undefined) {
        sessionStats.classCounts[t.className]++;
    }

    sessionStats.alertsLog.unshift({
        time: new Date().toISOString(),
        trackId: t.trackId,
        className: t.className,
        confidence: t.conf,
        riskScore: t.riskScore,
        riskLevel: t.riskLevel
    });

    updateAnalyticsUI();
}

function updateAnalyticsUI() {
    document.getElementById("count-critical").textContent = sessionStats.critical;
    document.getElementById("count-high").textContent = sessionStats.high;
    document.getElementById("count-medium").textContent = sessionStats.medium;
    document.getElementById("count-low").textContent = sessionStats.low;

    const total = Object.values(sessionStats.classCounts).reduce((a, b) => a + b, 0) || 1;

    for (const [cls, count] of Object.entries(sessionStats.classCounts)) {
        const bar = document.getElementById(`bar-${cls}`);
        const num = document.getElementById(`num-${cls}`);
        if (bar && num) {
            const pct = Math.round((count / total) * 100);
            bar.style.width = `${pct}%`;
            num.textContent = count;
        }
    }

    const fullLogList = document.getElementById("full-session-log");
    if (sessionStats.alertsLog.length > 0) {
        fullLogList.innerHTML = sessionStats.alertsLog.map(item => `
            <div class="alert-item ${item.riskLevel}">
                <span>Track #${item.trackId} - <strong>${item.className}</strong></span>
                <span>Score: ${item.riskScore} (${item.riskLevel})</span>
            </div>
        `).join("");
    }
}

async function runOnImage(img) {
    const canvas = document.getElementById("image-canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    riskScorer.setDimensions(canvas.width, canvas.height);
    const tracker = new HazardTracker(0.3, 15);

    const rawDetections = await detectFrame(img);
    const tracked = tracker.update(rawDetections);

    // Log detected hazards to Firestore
    if (typeof logTrackedHazards === "function") {
        logTrackedHazards(tracked);
    }

    renderDetections(canvas, img, tracked);

    const table = document.getElementById("image-detections-table");
    if (tracked.length === 0) {
        table.innerHTML = '<div class="table-empty">No hazards detected in selected image. Try lowering Confidence Threshold in settings.</div>';
    } else {
        table.innerHTML = `
            <div class="det-row" style="font-weight:bold; border-bottom:1px solid rgba(255,255,255,0.1)">
                <span>Hazard</span><span>Conf</span><span>Risk</span><span>Level</span>
            </div>
            ${tracked.map(t => {
                recordSessionStats(t);
                return `
                    <div class="det-row">
                        <span>${t.className}</span>
                        <span>${t.conf.toFixed(2)}</span>
                        <span>${t.riskScore.toFixed(1)}</span>
                        <span style="color:${RISK_LEVEL_COLORS[t.riskLevel]}">${t.riskLevel}</span>
                    </div>
                `;
            }).join("")}
        `;
    }
}

// Process Recorded Video
async function processVideo(videoElem) {
    if (isProcessingVideo) return;
    isProcessingVideo = true;
    videoProcessingStop = false;

    const btnProcess = document.getElementById("btn-process-video");
    const btnStop = document.getElementById("btn-stop-video");
    const canvas = document.getElementById("video-canvas");
    const progressBar = document.getElementById("video-progress");

    btnProcess.disabled = true;
    btnStop.disabled = false;

    canvas.width = videoElem.videoWidth || 640;
    canvas.height = videoElem.videoHeight || 480;

    riskScorer.setDimensions(canvas.width, canvas.height);
    const tracker = new HazardTracker(0.3, 15);

    videoElem.currentTime = 0;
    await videoElem.play();

    while (!videoElem.ended && !videoProcessingStop) {
        const rawDetections = await detectFrame(videoElem);
        const tracked = tracker.update(rawDetections);

        // Log detected hazards to Firestore
        if (typeof logTrackedHazards === "function") {
            logTrackedHazards(tracked);
        }

        renderDetections(canvas, videoElem, tracked);

        for (const t of tracked) {
            if (t.isNew) {
                const list = document.getElementById("video-alerts-list");
                const emptyMsg = list.querySelector(".alert-empty");
                if (emptyMsg) emptyMsg.remove();

                const item = document.createElement("div");
                item.className = `alert-item ${t.riskLevel}`;
                item.innerHTML = `<span>Frame hazard: #${t.trackId} <strong>${t.className}</strong></span><span>Risk: ${t.riskScore} (${t.riskLevel})</span>`;
                list.prepend(item);
                recordSessionStats(t);
            }
        }

        const pct = (videoElem.currentTime / (videoElem.duration || 1)) * 100;
        progressBar.style.width = `${pct}%`;

        await new Promise(r => requestAnimationFrame(r));
    }

    videoElem.pause();
    isProcessingVideo = false;
    btnProcess.disabled = false;
    btnStop.disabled = true;
}

function exportLogJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionStats.alertsLog, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `roadshield_alerts_${Date.now()}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
}

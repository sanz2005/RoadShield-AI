/**
 * RoadShield AI Mobile Engine
 * Port of risk_scoring.py and tracker.py to JavaScript.
 * Preserves exact proprietary algorithms and thresholds.
 */

class RiskScorer {
    static CLASS_SEVERITY = {
        "open_manhole": 10.0,
        "pothole": 6.0,
        "manhole": 3.0,
        "unmarked_bump": 5.0,
        "speed_bump": 2.0,
        "crack": 2.5,
        "debris": 5.5
    };

    constructor(frameWidth = 640, frameHeight = 640) {
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.frameArea = frameWidth * frameHeight;
    }

    setDimensions(width, height) {
        this.frameWidth = width;
        this.frameHeight = height;
        this.frameArea = width * height;
    }

    _sizeFactor(x1, y1, x2, y2) {
        const boxArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const relativeSize = boxArea / (this.frameArea || 1);
        return Math.min(relativeSize / 0.15, 1.0);
    }

    _positionFactor(y1, y2) {
        const bottomY = Math.max(y1, y2);
        return bottomY / (this.frameHeight || 1);
    }

    computeRisk(className, confidence, x1, y1, x2, y2) {
        const baseSeverity = RiskScorer.CLASS_SEVERITY[className] ?? 3.0;
        const sizeFactor = this._sizeFactor(x1, y1, x2, y2);
        const positionFactor = this._positionFactor(y1, y2);

        const rawScore = baseSeverity * (0.5 + 0.3 * sizeFactor + 0.2 * positionFactor);
        let riskScore = rawScore * confidence;
        riskScore = Math.min(riskScore, 10.0);

        let level = "LOW";
        if (riskScore >= 7.5) {
            level = "CRITICAL";
        } else if (riskScore >= 5.0) {
            level = "HIGH";
        } else if (riskScore >= 2.5) {
            level = "MEDIUM";
        }

        return {
            risk_score: parseFloat(riskScore.toFixed(2)),
            risk_level: level,
            base_severity: baseSeverity,
            size_factor: parseFloat(sizeFactor.toFixed(3)),
            position_factor: parseFloat(positionFactor.toFixed(3)),
            confidence: confidence
        };
    }
}

class Track {
    constructor(trackId, className, box, riskScore, riskLevel) {
        this.trackId = trackId;
        this.className = className;
        this.box = box; // [x1, y1, x2, y2]
        this.riskScore = riskScore;
        this.riskLevel = riskLevel;
        this.age = 0;
        this.hits = 1;
        this.alerted = false;
    }
}

class HazardTracker {
    constructor(iouThreshold = 0.3, maxAge = 15) {
        this.iouThreshold = iouThreshold;
        this.maxAge = maxAge;
        this.tracks = new Map();
        this.nextId = 1;
    }

    static iou(box1, box2) {
        const x1 = Math.max(box1[0], box2[0]);
        const y1 = Math.max(box1[1], box2[1]);
        const x2 = Math.min(box1[2], box2[2]);
        const y2 = Math.min(box1[3], box2[3]);

        const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const area1 = Math.max(0, box1[2] - box1[0]) * Math.max(0, box1[3] - box1[1]);
        const area2 = Math.max(0, box2[2] - box2[0]) * Math.max(0, box2[3] - box2[1]);
        const union = area1 + area2 - interArea;

        return union > 0 ? interArea / union : 0.0;
    }

    update(detections) {
        const matchedTrackIds = new Set();
        const results = [];

        for (const det of detections) {
            let bestIou = 0;
            let bestTrackId = null;

            for (const [trackId, track] of this.tracks.entries()) {
                if (matchedTrackIds.has(trackId)) continue;
                if (track.className !== det.className) continue;

                const iouVal = HazardTracker.iou(track.box, det.box);
                if (iouVal > bestIou) {
                    bestIou = iouVal;
                    bestTrackId = trackId;
                }
            }

            if (bestIou >= this.iouThreshold) {
                const track = this.tracks.get(bestTrackId);
                track.box = det.box;
                track.riskScore = det.riskScore;
                track.riskLevel = det.riskLevel;
                track.age = 0;
                track.hits += 1;
                matchedTrackIds.add(bestTrackId);

                const isNewAlert = !track.alerted;
                if (isNewAlert) {
                    track.alerted = true;
                }

                results.push({ ...det, trackId: bestTrackId, isNew: isNewAlert });
            } else {
                const newId = this.nextId++;
                const newTrack = new Track(newId, det.className, det.box, det.riskScore, det.riskLevel);
                newTrack.alerted = true;
                this.tracks.set(newId, newTrack);

                results.push({ ...det, trackId: newId, isNew: true });
            }
        }

        // Age out unmatched tracks
        for (const [trackId, track] of this.tracks.entries()) {
            if (!matchedTrackIds.has(trackId)) {
                track.age += 1;
                if (track.age > this.maxAge) {
                    this.tracks.delete(trackId);
                }
            }
        }

        return results;
    }

    reset() {
        this.tracks.clear();
        this.nextId = 1;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RiskScorer, HazardTracker };
}

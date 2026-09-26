class Track:
    """Represents a single tracked hazard across frames."""
    def __init__(self, track_id, class_name, box, risk_score, risk_level):
        self.track_id = track_id
        self.class_name = class_name
        self.box = box  # (x1, y1, x2, y2)
        self.risk_score = risk_score
        self.risk_level = risk_level
        self.age = 0            # frames since last matched
        self.hits = 1           # total times matched
        self.alerted = False    # whether this hazard has already triggered an alert


class HazardTracker:
    """
    Simple IOU-based multi-object tracker (proprietary, no external tracking library).
    Matches new detections to existing tracks using IoU overlap between frames.
    """
    def __init__(self, iou_threshold=0.3, max_age=15):
        self.iou_threshold = iou_threshold
        self.max_age = max_age  # frames to keep a track alive without a match
        self.tracks = {}
        self.next_id = 1

    @staticmethod
    def _iou(box1, box2):
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])

        inter_area = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = max(0, box1[2] - box1[0]) * max(0, box1[3] - box1[1])
        area2 = max(0, box2[2] - box2[0]) * max(0, box2[3] - box2[1])
        union = area1 + area2 - inter_area

        return inter_area / union if union > 0 else 0.0

    def update(self, detections):
        """
        detections: list of dicts with keys: class_name, box (x1,y1,x2,y2), risk_score, risk_level
        Returns: list of dicts with an added 'track_id' and 'is_new' flag.
        """
        matched_track_ids = set()
        results = []

        for det in detections:
            best_iou = 0
            best_track_id = None

            for track_id, track in self.tracks.items():
                if track_id in matched_track_ids:
                    continue
                if track.class_name != det["class_name"]:
                    continue
                iou = self._iou(track.box, det["box"])
                if iou > best_iou:
                    best_iou = iou
                    best_track_id = track_id

            if best_iou >= self.iou_threshold:
                # Matched to an existing track — update it
                track = self.tracks[best_track_id]
                track.box = det["box"]
                track.risk_score = det["risk_score"]
                track.risk_level = det["risk_level"]
                track.age = 0
                track.hits += 1
                matched_track_ids.add(best_track_id)

                is_new_alert = not track.alerted
                if is_new_alert:
                    track.alerted = True

                results.append({**det, "track_id": best_track_id, "is_new": is_new_alert})
            else:
                # No match — create a new track
                new_id = self.next_id
                self.next_id += 1
                new_track = Track(new_id, det["class_name"], det["box"], det["risk_score"], det["risk_level"])
                new_track.alerted = True
                self.tracks[new_id] = new_track

                results.append({**det, "track_id": new_id, "is_new": True})

        # Age out unmatched tracks, remove stale ones
        for track_id in list(self.tracks.keys()):
            if track_id not in matched_track_ids:
                self.tracks[track_id].age += 1
                if self.tracks[track_id].age > self.max_age:
                    del self.tracks[track_id]

        return results


if __name__ == "__main__":
    # Sanity test: simulate 3 frames with a hazard moving slightly
    tracker = HazardTracker()

    frame1 = [{"class_name": "open_manhole", "box": (100, 100, 200, 200), "risk_score": 8.0, "risk_level": "CRITICAL"}]
    frame2 = [{"class_name": "open_manhole", "box": (105, 102, 205, 202), "risk_score": 8.1, "risk_level": "CRITICAL"}]
    frame3 = [{"class_name": "open_manhole", "box": (110, 104, 210, 204), "risk_score": 8.2, "risk_level": "CRITICAL"},
              {"class_name": "pothole", "box": (400, 400, 450, 450), "risk_score": 4.0, "risk_level": "MEDIUM"}]

    for i, frame in enumerate([frame1, frame2, frame3], 1):
        print(f"\n--- Frame {i} ---")
        results = tracker.update(frame)
        for r in results:
            print(f"  ID {r['track_id']} | {r['class_name']} | new={r['is_new']} | risk={r['risk_score']}")
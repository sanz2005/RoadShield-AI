class RiskScorer:
    """
    Proprietary risk-scoring module for RoadShield AI.
    Combines hazard class severity, relative size (distance proxy),
    and detection confidence into a single actionable risk score.
    """

    # Base severity weight per class (0-10 scale, higher = more dangerous)
    CLASS_SEVERITY = {
        "open_manhole": 10.0,   # most dangerous — can cause serious accidents
        "pothole": 6.0,
        "manhole": 3.0,         # covered manhole — low risk
        "unmarked_bump": 5.0,
        "speed_bump": 2.0,      # expected/marked, low risk
        "crack": 2.5,
        "debris": 5.5,
    }

    def __init__(self, frame_width, frame_height):
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.frame_area = frame_width * frame_height

    def _size_factor(self, x1, y1, x2, y2):
        """
        Larger bounding box relative to frame = closer/larger hazard = higher risk.
        Returns a factor between 0 and 1.
        """
        box_area = max(0, (x2 - x1)) * max(0, (y2 - y1))
        relative_size = box_area / self.frame_area
        # Normalize: assume a hazard covering >15% of frame is "very close/large"
        size_factor = min(relative_size / 0.15, 1.0)
        return size_factor

    def _position_factor(self, y1, y2):
        """
        Hazards lower in the frame (closer to the car/camera) are more urgent.
        Returns a factor between 0 and 1.
        """
        bottom_y = max(y1, y2)
        position_factor = bottom_y / self.frame_height
        return position_factor

    def compute_risk(self, class_name, confidence, x1, y1, x2, y2):
        """
        Returns: dict with risk_score (0-10), risk_level (str), and component breakdown.
        """
        base_severity = self.CLASS_SEVERITY.get(class_name, 3.0)
        size_factor = self._size_factor(x1, y1, x2, y2)
        position_factor = self._position_factor(y1, y2)

        # Weighted combination — proprietary formula:
        # severity dominates, size and position modulate it, confidence gates reliability
        raw_score = base_severity * (0.5 + 0.3 * size_factor + 0.2 * position_factor)
        risk_score = raw_score * confidence
        risk_score = min(risk_score, 10.0)  # cap at 10

        if risk_score >= 7.5:
            level = "CRITICAL"
        elif risk_score >= 5.0:
            level = "HIGH"
        elif risk_score >= 2.5:
            level = "MEDIUM"
        else:
            level = "LOW"

        return {
            "risk_score": round(risk_score, 2),
            "risk_level": level,
            "base_severity": base_severity,
            "size_factor": round(size_factor, 3),
            "position_factor": round(position_factor, 3),
            "confidence": confidence,
        }


if __name__ == "__main__":
    # Sanity test
    scorer = RiskScorer(frame_width=1280, frame_height=720)

    test_cases = [
        ("open_manhole", 0.85, 500, 500, 700, 680),  # large, low in frame, high conf
        ("open_manhole", 0.45, 600, 100, 650, 150),  # small, high in frame, low conf
        ("pothole", 0.70, 400, 400, 600, 600),
        ("speed_bump", 0.90, 100, 600, 1100, 700),   # wide, expected hazard
        ("crack", 0.60, 300, 300, 350, 320),
    ]

    for cls, conf, x1, y1, x2, y2 in test_cases:
        result = scorer.compute_risk(cls, conf, x1, y1, x2, y2)
        print(f"{cls:15s} | conf={conf:.2f} | Risk: {result['risk_score']:.2f} ({result['risk_level']})")
import cv2
from ultralytics import YOLO
import os
from risk_scoring import RiskScorer
from tracker import HazardTracker

MODEL_PATH = r"D:\RoadShield AI\runs\detect\runs\road_hazard_v2\weights\best.pt"
CLASS_NAMES = ["open_manhole", "manhole", "pothole", "crack", "debris", "speed_bump", "unmarked_bump"]

CLASS_COLORS = {
    0: (0, 0, 255), 1: (0, 165, 255), 2: (0, 255, 255),
    3: (255, 0, 0), 4: (255, 0, 255), 5: (0, 255, 0), 6: (255, 255, 0),
}

RISK_LEVEL_COLORS = {
    "CRITICAL": (0, 0, 255), "HIGH": (0, 100, 255),
    "MEDIUM": (0, 255, 255), "LOW": (0, 255, 0),
}


def draw_detection(img, x1, y1, x2, y2, class_name, conf, risk_result, box_color, track_id=None, is_new=None):
    cv2.rectangle(img, (x1, y1), (x2, y2), box_color, 2)

    id_tag = f"#{track_id} " if track_id is not None else ""
    new_tag = " [NEW]" if is_new else ""
    label = f"{id_tag}{class_name} {conf:.2f}{new_tag}"
    risk_label = f"Risk: {risk_result['risk_score']:.1f} ({risk_result['risk_level']})"

    risk_color = RISK_LEVEL_COLORS.get(risk_result["risk_level"], (255, 255, 255))

    (tw1, th1), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    (tw2, th2), _ = cv2.getTextSize(risk_label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    max_w = max(tw1, tw2)

    cv2.rectangle(img, (x1, y1 - th1 - th2 - 14), (x1 + max_w + 6, y1), box_color, -1)
    cv2.putText(img, label, (x1 + 3, y1 - th2 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)
    cv2.putText(img, risk_label, (x1 + 3, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.55, risk_color, 2)


def run_on_image(model, scorer, image_path, output_path, conf_threshold=0.4):
    results = model.predict(source=image_path, conf=conf_threshold, verbose=False)
    result = results[0]

    img = cv2.imread(image_path)
    detections_summary = []

    for box in result.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        class_name = CLASS_NAMES[cls_id]

        risk_result = scorer.compute_risk(class_name, conf, x1, y1, x2, y2)
        color = CLASS_COLORS.get(cls_id, (255, 255, 255))

        draw_detection(img, x1, y1, x2, y2, class_name, conf, risk_result, color)
        detections_summary.append((class_name, conf, risk_result["risk_score"], risk_result["risk_level"]))

    cv2.imwrite(output_path, img)
    print(f"\n{os.path.basename(output_path)}:")
    for cls, conf, score, level in detections_summary:
        print(f"  {cls:15s} conf={conf:.2f}  risk={score:.2f} ({level})")


def run_on_video(model, scorer, video_path, output_path, conf_threshold=0.4):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"❌ Could not open video: {video_path}")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    tracker = HazardTracker(iou_threshold=0.3, max_age=15)

    frame_count = 0
    new_alerts_log = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = model.predict(source=frame, conf=conf_threshold, verbose=False)
        result = results[0]

        raw_detections = []
        for box in result.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            class_name = CLASS_NAMES[cls_id]

            risk_result = scorer.compute_risk(class_name, conf, x1, y1, x2, y2)
            raw_detections.append({
                "class_name": class_name,
                "box": (x1, y1, x2, y2),
                "risk_score": risk_result["risk_score"],
                "risk_level": risk_result["risk_level"],
                "conf": conf,
                "risk_result": risk_result,
            })

        tracked = tracker.update(raw_detections)

        for t in tracked:
            x1, y1, x2, y2 = t["box"]
            cls_id = CLASS_NAMES.index(t["class_name"])
            color = CLASS_COLORS.get(cls_id, (255, 255, 255))

            draw_detection(
                frame, x1, y1, x2, y2, t["class_name"], t["conf"], t["risk_result"],
                color, track_id=t["track_id"], is_new=t["is_new"]
            )

            if t["is_new"]:
                new_alerts_log.append(f"Frame {frame_count}: NEW {t['class_name']} (ID {t['track_id']}) - {t['risk_level']}")

        out.write(frame)
        frame_count += 1
        if frame_count % 30 == 0:
            print(f"Processed {frame_count} frames...")

    cap.release()
    out.release()
    print(f"\n✅ Video saved: {output_path} ({frame_count} frames)")
    print(f"\n=== New Hazard Alerts ({len(new_alerts_log)}) ===")
    for log in new_alerts_log:
        print(f"  {log}")


if __name__ == "__main__":
    print("Loading model...")
    model = YOLO(MODEL_PATH)
    print("✅ Model loaded")

    os.makedirs("inference_outputs", exist_ok=True)
    scorer = RiskScorer(frame_width=640, frame_height=640)

    TEST_IMAGES_DIR = r"D:\RoadShield AI\merged_dataset\test\images"
    sample_images = os.listdir(TEST_IMAGES_DIR)[:10]

    for img_name in sample_images:
        img_path = os.path.join(TEST_IMAGES_DIR, img_name)
        output_path = os.path.join("inference_outputs", f"pred_{img_name}")
        run_on_image(model, scorer, img_path, output_path)

    # ---------------- Uncomment to test on a video ----------------
    # scorer_video = RiskScorer(frame_width=1280, frame_height=720)  # match your video resolution
    # run_on_video(model, scorer_video, r"D:\path\to\dashcam_video.mp4", "inference_outputs/output_video.mp4")
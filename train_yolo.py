from ultralytics import YOLO

def main():
    model = YOLO("yolov8s.pt")  # pretrained base model, auto-downloads if not present

    model.train(
        data=r"D:\RoadShield AI\merged_dataset\data.yaml",
        epochs=100,
        imgsz=640,
        batch=16,
        device=0,           # GPU (RTX 5050)
        project="runs",
        name="road_hazard_v2",
        patience=20,        # early stop if no improvement for 20 epochs
        workers=4,
        save_period=1,      # checkpoint every epoch (crash-safety)
        resume=False,       # set True manually if resuming an interrupted run
    )

if __name__ == "__main__":
    main()
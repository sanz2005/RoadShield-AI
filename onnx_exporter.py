import os
import sys
from ultralytics import YOLO

MODEL_PATH = r"D:\RoadShield AI\runs\detect\runs\road_hazard_v2\weights\best.pt"
OUTPUT_DIR = r"D:\RoadShield AI\mobile_app\assets"

def main():
    if not os.path.exists(MODEL_PATH):
        print(f"❌ Model file not found at: {MODEL_PATH}")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    onnx_target = os.path.join(OUTPUT_DIR, "best.onnx")

    print(f"📦 Loading PyTorch model from: {MODEL_PATH}")
    model = YOLO(MODEL_PATH)

    print("🚀 Exporting model to ONNX format (opset=12)...")
    exported_path = model.export(format="onnx", opset=12, simplify=False)
    
    print(f"Exported to: {exported_path}")
    if os.path.exists(exported_path):
        import shutil
        shutil.copy(exported_path, onnx_target)
        print(f"✅ ONNX model successfully copied to: {onnx_target} ({os.path.getsize(onnx_target)} bytes)")

if __name__ == "__main__":
    main()

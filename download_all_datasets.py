# download_all_datasets.py
from roboflow import Roboflow

API_KEY = "w8Tmv68gKcAxa9T9CM1Z"
rf = Roboflow(api_key=API_KEY)

datasets = [
    {"workspace": "sanz-zukjs", "project": "road-defects-yrflc-5sgqq", "version": 1, "name": "Road-Defects"},
    {"workspace": "street-hazard-wquul", "project": "road-hazards", "version": 1, "name": "Road-Hazards"},
    {"workspace": "indian-institute-of-technology-madras-xamot", "project": "pothole-detection-huf2x", "version": 1, "name": "Pothole-IITM"},
    {"workspace": "create-dataset-for-yolo", "project": "manhole-cover-dataset-yolo", "version": 1, "name": "Manhole-Cover"},
]

for d in datasets:
    print(f"\n--- Downloading {d['name']} ---")
    try:
        project = rf.workspace(d["workspace"]).project(d["project"])
        dataset = project.version(d["version"]).download("yolov8", location=f"datasets/{d['name']}")
        print(f"✅ Downloaded {d['name']} to: {dataset.location}")
    except Exception as e:
        print(f"❌ Failed for {d['name']}: {e}")

print("\nAll downloads attempted.")
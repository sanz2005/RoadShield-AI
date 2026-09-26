from roboflow import Roboflow

API_KEY = "w8Tmv68gKcAxa9T9CM1Z"
rf = Roboflow(api_key=API_KEY)

datasets = [
    {"workspace": "qassim-university-km0xb", "project": "road-anomalies-3iuzx", "version": 1, "name": "Road-Anomalies-Qassim"},
    {"workspace": "aibased-solution-for-realtime-detection-of-road-anomalies-d6eay", "project": "open-manholes", "version": 1, "name": "Open-Manholes-Dedicated"},
    {"workspace": "cse400b", "project": "pothole-and-speed-breaker-dataset-400b", "version": 1, "name": "Pothole-SpeedBreaker"},
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
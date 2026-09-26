# check_new_datasets.py
import yaml
import os

for folder in ["Road-Anomalies-Qassim", "Open-Manholes-Dedicated", "Pothole-SpeedBreaker"]:
    yaml_path = os.path.join("datasets", folder, "data.yaml")
    if not os.path.exists(yaml_path):
        print(f"\n=== {folder} ===\n❌ data.yaml not found!")
        continue
    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)
    print(f"\n=== {folder} ===")
    print("Classes:", config.get("names"))
    print("nc:", config.get("nc"))

    for split in ["train", "valid", "test"]:
        img_dir = os.path.join("datasets", folder, split, "images")
        if os.path.exists(img_dir):
            print(f"{split}: {len(os.listdir(img_dir))} images")
        else:
            print(f"{split}: not found")
# check_all_datasets.py
import os
import yaml

base_path = r"D:\RoadShield AI\datasets"

for folder in os.listdir(base_path):
    dataset_path = os.path.join(base_path, folder)
    yaml_path = os.path.join(dataset_path, "data.yaml")
    
    print(f"\n=== {folder} ===")
    
    if not os.path.exists(yaml_path):
        print("❌ data.yaml not found!")
        continue
    
    with open(yaml_path, "r") as f:
        data_config = yaml.safe_load(f)
    
    print("Classes:", data_config.get("names"))
    print("Number of classes:", data_config.get("nc"))
    
    for split in ["train", "valid", "test"]:
        img_dir = os.path.join(dataset_path, split, "images")
        if os.path.exists(img_dir):
            img_count = len(os.listdir(img_dir))
            print(f"{split}: {img_count} images")
        else:
            print(f"{split}: not found")
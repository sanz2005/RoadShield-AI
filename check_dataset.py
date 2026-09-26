# check_dataset.py
import os
import yaml

dataset_path = r"D:\RoadShield AI\Road-Defects-1"

# Check data.yaml
with open(os.path.join(dataset_path, "data.yaml"), "r") as f:
    data_config = yaml.safe_load(f)

print("Classes:", data_config.get("names"))
print("Number of classes:", data_config.get("nc"))

# Check folder structure and counts
for split in ["train", "valid", "test"]:
    img_dir = os.path.join(dataset_path, split, "images")
    label_dir = os.path.join(dataset_path, split, "labels")
    if os.path.exists(img_dir):
        img_count = len(os.listdir(img_dir))
        label_count = len(os.listdir(label_dir))
        print(f"{split}: {img_count} images, {label_count} labels")
    else:
        print(f"{split}: folder not found")
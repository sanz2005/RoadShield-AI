# verify_merged.py
import os
import yaml
from collections import Counter

OUTPUT = r"D:\RoadShield AI\merged_dataset"

with open(os.path.join(OUTPUT, "data.yaml"), "r") as f:
    config = yaml.safe_load(f)

print("Classes:", config["names"])
print("Number of classes:", config["nc"])

for split in ["train", "valid", "test"]:
    img_dir = os.path.join(OUTPUT, split, "images")
    label_dir = os.path.join(OUTPUT, split, "labels")
    img_count = len(os.listdir(img_dir))
    label_count = len(os.listdir(label_dir))
    print(f"\n{split}: {img_count} images, {label_count} labels")

    # Class distribution
    class_counts = Counter()
    for label_file in os.listdir(label_dir):
        with open(os.path.join(label_dir, label_file), "r") as f:
            for line in f:
                class_id = int(line.strip().split()[0])
                class_counts[config["names"][class_id]] += 1
    for cls, count in sorted(class_counts.items(), key=lambda x: -x[1]):
        print(f"  {cls}: {count} instances")
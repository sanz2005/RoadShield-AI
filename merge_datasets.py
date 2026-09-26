import os
import shutil
import yaml

BASE = r"D:\RoadShield AI\datasets"
OUTPUT = r"D:\RoadShield AI\merged_dataset"

UNIFIED_CLASSES = [
    "open_manhole",   # 0
    "manhole",        # 1
    "pothole",        # 2
    "crack",          # 3
    "debris",         # 4
    "speed_bump",     # 5
    "unmarked_bump",  # 6
]
CLASS_TO_ID = {name: i for i, name in enumerate(UNIFIED_CLASSES)}

DATASET_MAPPINGS = {
    "Road-Defects": {
        "Open Manhole": "open_manhole",
        "Manhole": "manhole",
        "Pothole": "pothole",
        "Speed Bump": "speed_bump",
        "Unmarked Bump": "unmarked_bump",
    },
    "Road-Hazards": {
        "manhole-cover": "manhole",
        "cracks": "crack",
        "pothole": "pothole",
        "obstracle": "debris",
    },
    "Pothole-IITM": {
        "pothole": "pothole",
        "crocodile crack": "crack",
        "longitudinal crack": "crack",
    },
    "Manhole-Cover": {
        "Uncovered": "open_manhole",
        "Broken": "manhole",
        "Good": "manhole",
        "Lose": "manhole",
    },
    "Road-Anomalies-Qassim": {
        "Open Manhole": "open_manhole",
        "Manhole": "manhole",
        "Pothole": "pothole",
        "Speed Bump": "speed_bump",
        "Unmarked Bump": "unmarked_bump",
    },
    "Open-Manholes-Dedicated": {
        "Open-Manholes": "open_manhole",
        "Manhole": "manhole",
    },
    "Pothole-SpeedBreaker": {
        "Pothole": "pothole",
        "SpeedBreaker": "speed_bump",
    },
}

def load_yaml_classes(dataset_folder):
    yaml_path = os.path.join(BASE, dataset_folder, "data.yaml")
    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)
    return config["names"]

def process_split(dataset_folder, split, old_id_to_new_id, prefix):
    img_dir = os.path.join(BASE, dataset_folder, split, "images")
    label_dir = os.path.join(BASE, dataset_folder, split, "labels")

    if not os.path.exists(img_dir):
        print(f"  [{split}] not found, skipping")
        return 0

    out_img_dir = os.path.join(OUTPUT, split, "images")
    out_label_dir = os.path.join(OUTPUT, split, "labels")

    count = 0
    for img_file in os.listdir(img_dir):
        name, ext = os.path.splitext(img_file)
        label_file = name + ".txt"
        label_path = os.path.join(label_dir, label_file)

        if not os.path.exists(label_path):
            continue

        new_name = f"{prefix}_{name}"

        shutil.copy(
            os.path.join(img_dir, img_file),
            os.path.join(out_img_dir, new_name + ext)
        )

        with open(label_path, "r") as f:
            lines = f.readlines()

        new_lines = []
        for line in lines:
            parts = line.strip().split()
            if not parts:
                continue
            old_class_id = int(parts[0])
            if old_class_id not in old_id_to_new_id:
                continue
            new_class_id = old_id_to_new_id[old_class_id]
            new_line = " ".join([str(new_class_id)] + parts[1:])
            new_lines.append(new_line)

        if new_lines:
            with open(os.path.join(out_label_dir, new_name + ".txt"), "w") as f:
                f.write("\n".join(new_lines))
            count += 1
        else:
            os.remove(os.path.join(out_img_dir, new_name + ext))

    return count


def main():
    # Clear old merged output first (fresh merge with new datasets included)
    for split in ["train", "valid", "test"]:
        for sub in ["images", "labels"]:
            folder = os.path.join(OUTPUT, split, sub)
            os.makedirs(folder, exist_ok=True)
            for f in os.listdir(folder):
                os.remove(os.path.join(folder, f))

    for dataset_folder, class_map in DATASET_MAPPINGS.items():
        print(f"\nProcessing {dataset_folder}...")
        original_classes = load_yaml_classes(dataset_folder)

        old_id_to_new_id = {}
        for old_id, old_name in enumerate(original_classes):
            if old_name in class_map:
                unified_name = class_map[old_name]
                old_id_to_new_id[old_id] = CLASS_TO_ID[unified_name]

        for split in ["train", "valid", "test"]:
            n = process_split(dataset_folder, split, old_id_to_new_id, prefix=dataset_folder.lower().replace(" ", "_").replace("-", "_"))
            print(f"  [{split}] processed: {n} images")

    yaml_content = {
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": len(UNIFIED_CLASSES),
        "names": UNIFIED_CLASSES,
    }
    with open(os.path.join(OUTPUT, "data.yaml"), "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False)

    print("\n✅ Merge complete. Output at:", OUTPUT)


if __name__ == "__main__":
    main()
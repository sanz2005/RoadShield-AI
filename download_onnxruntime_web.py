import os
import urllib.request

DEST_DIR = r"D:\RoadShield AI\mobile_app"

FILES = [
    ("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort.min.js", "ort.min.js"),
    ("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm.wasm", "ort-wasm.wasm"),
    ("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm-simd.wasm", "ort-wasm-simd.wasm"),
    ("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.wasm"),
]

def main():
    os.makedirs(DEST_DIR, exist_ok=True)
    for url, filename in FILES:
        target_path = os.path.join(DEST_DIR, filename)
        print(f"[DOWNLOAD] Downloading {filename} from {url}...")
        try:
            urllib.request.urlretrieve(url, target_path)
            print(f"[OK] {filename} saved ({os.path.getsize(target_path)} bytes)")
        except Exception as e:
            print(f"[ERROR] Failed to download {filename}: {e}")

if __name__ == "__main__":
    main()

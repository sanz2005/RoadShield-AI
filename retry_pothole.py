from roboflow import Roboflow

API_KEY = "w8Tmv68gKcAxa9T9CM1Z"
rf = Roboflow(api_key=API_KEY)

project = rf.workspace("cse400b").project("pothole-and-speed-breaker-dataset-400b")
dataset = project.version(1).download("yolov8", location="datasets/Pothole-SpeedBreaker")

print("Downloaded to:", dataset.location)
"""Measure HOG+SVM detection and the 68-point predictor on the supplied video fixtures."""

import argparse
import json
from pathlib import Path
from time import perf_counter

import cv2
import dlib


def measure(path, detector, predictor):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not read {path}")
    index = 0
    try:
        while True:
            success, bgr = capture.read()
            if not success:
                break
            start = perf_counter()
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            boxes = detector(gray, 0)
            if boxes:
                largest = max(boxes, key=lambda box: box.area())
                predictor(gray, largest)
            latency = (perf_counter() - start) * 1000
            yield {
                "method": "dlib", "file": path.name, "frame": index,
                "tracked": int(bool(boxes)), "latency": latency,
            }
            index += 1
    finally:
        capture.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictor", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("tmp/evidence/dlib.json"))
    parser.add_argument("--clips", type=Path, default=Path("test_videos"))
    args = parser.parse_args()
    cv2.setNumThreads(1)
    detector = dlib.get_frontal_face_detector()
    predictor = dlib.shape_predictor(str(args.predictor))
    rows = [
        row for path in sorted(args.clips.glob("*.mp4"))
        for row in measure(path, detector, predictor)
    ]
    if not rows:
        raise RuntimeError(f"No video frames were decoded from {args.clips}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({
        "environment": f"dlib {dlib.__version__}, OpenCV {cv2.__version__}, HOG upsample=0",
        "rows": rows,
    }))
    print(f"dlib benchmark logged {len(rows)} frames.")


if __name__ == "__main__":
    main()

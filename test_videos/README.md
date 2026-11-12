# Controlled video fixtures

All clips have 90 frames at 320 × 320 and 15 frames per second. They contain no audio.

- **portrait.mp4** repeats a crop of a NASA portrait of Eileen Collins, available as [scikit-image astronaut data](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut).
- **low-light.mp4** applies reduced brightness and contrast to the same frames.
- **eye-occlusion.mp4** places a solid band over the eye region in the same frames.
- **no-face.mp4** contains a constant gray field.

These files support repeatable face-presence and inference timings. They contain no labeled physiological events. The synthetic event inputs in the test suite are timestamped metric sequences.

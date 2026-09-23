"""Rebuild the exact original standalone index.html."""
import base64
import hashlib
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parts = sorted((root / "media").glob("video.part*"))
if len(parts) != 17:
    raise RuntimeError(f"Expected 17 video parts, found {len(parts)}")
video = b"".join(part.read_bytes() for part in parts)
original = (
    (root / "source" / "before-video.part").read_bytes()
    + base64.b64encode(video)
    + (root / "source" / "after-video.part").read_bytes()
)
expected = "25d9f87edb7fd1138d3c8b9809b3f90048437c8aaac7c065d2565e2ede7a8bdd"
actual = hashlib.sha256(original).hexdigest()
if actual != expected:
    raise RuntimeError(f"Original file checksum mismatch: {actual}")
output = root / "original-index.html"
output.write_bytes(original)
print(f"Restored {output} ({len(original)} bytes, SHA-256 {actual})")

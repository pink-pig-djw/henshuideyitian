The repository root index.html loads the MP4 from media/video.part01 through
media/video.part17 so each GitHub upload stays small.

To restore the exact original standalone HTML file, run:

    python source/restore_original.py

This creates original-index.html in the repository root and verifies its
SHA-256 checksum. The restored file is self-contained and works offline.

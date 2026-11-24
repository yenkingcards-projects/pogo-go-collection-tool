# 11: Auto-delete screenshots and videos after use

**What to build:** Uploaded screenshots, videos and video frames pile up in `data/uploads` (about 1.5–2 MB per screenshot, far more per video). Ben wants them deleted once used, so the app doesn't eat disk space. (Ben asked for this 2026-11-22, which is his yes for the app deleting its own uploads.)

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Successful scan: the screenshot is deleted right after its numbers are saved
- [x] Video: the video and its frames folder are deleted when the batch job finishes
- [x] Failed scan: kept 7 days (so Ben can see why it failed), then deleted automatically
- [x] Only files inside `data/uploads/` are ever deleted
- [x] Web page footer shows how much space uploads use
- [x] Tests cover all three cases

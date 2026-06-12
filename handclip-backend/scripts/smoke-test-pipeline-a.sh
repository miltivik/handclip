#!/usr/bin/env bash
# ============================================================
# Smoke Test — Pipeline A (Upload → Transcribe → Analyze → Clips)
# ============================================================
#
# Prerequisites:
#   - Docker services running: docker compose up -d redis
#   - Backend running: cd handclip-backend && pnpm dev
#   - ffmpeg and ffprobe installed locally
#
# Usage:
#   bash scripts/smoke-test-pipeline-a.sh [API_URL]
#
# Default API_URL: http://localhost:3000/api

set -euo pipefail

API_URL="${1:-http://localhost:3000/api}"
TEST_DIR="/tmp/handclip-smoke-test-$$"
PASSED=0
FAILED=0

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
mkdir -p "$TEST_DIR"

# ── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

# ── Pre-flight checks ─────────────────────────────────────
echo "=== Smoke Test: Pipeline A ==="
echo "API: $API_URL"
echo ""

# Check ffmpeg
if command -v ffmpeg &>/dev/null; then
  pass "ffmpeg available"
else
  fail "ffmpeg not found — install ffmpeg to generate test video"
  exit 1
fi

# Check API is reachable
if curl -sf "$API_URL/health" > /dev/null 2>&1; then
  pass "API health check OK"
else
  fail "API not reachable at $API_URL — start backend first"
  exit 1
fi

# ── Step 1: Generate test video ────────────────────────────
echo ""
echo "--- Step 1: Generate test video ---"
TEST_VIDEO="$TEST_DIR/test-video.mp4"
# 30-second test video: color bars + sine wave audio
ffmpeg -y \
  -f lavfi -i "testsrc=duration=30:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=30" \
  -c:v libx264 -preset ultrafast -crf 28 \
  -c:a aac -b:a 128k \
  -shortest "$TEST_VIDEO" 2>/dev/null

if [ -f "$TEST_VIDEO" ]; then
  VSIZE=$(stat -f%z "$TEST_VIDEO" 2>/dev/null || stat -c%s "$TEST_VIDEO" 2>/dev/null)
  echo "  Generated test video: $(du -h "$TEST_VIDEO" | cut -f1)"
  pass "Test video generated ($VSIZE bytes)"
else
  fail "Failed to generate test video"
  exit 1
fi

# ── Step 2: Upload video ───────────────────────────────────
echo ""
echo "--- Step 2: Upload video ---"
UPLOAD_RESPONSE=$(curl -sf -X POST "$API_URL/projects/upload" \
  -F "video=@$TEST_VIDEO" \
  -F "name=smoke-test-video.mp4")

echo "  Upload response: $UPLOAD_RESPONSE"

PROJECT_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"projectId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

if [ -z "$PROJECT_ID" ]; then
  # Try extracting 'id' if projectId isn't returned
  PROJECT_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
fi

if [ -n "$PROJECT_ID" ]; then
  pass "Video uploaded (projectId: $PROJECT_ID)"
else
  fail "Upload failed — no projectId in response"
  echo "  Response: $UPLOAD_RESPONSE"
  exit 1
fi

# ── Step 3: Trigger analysis ───────────────────────────────
echo ""
echo "--- Step 3: Trigger analysis ---"
ANALYZE_RESPONSE=$(curl -sf -X POST "$API_URL/projects/$PROJECT_ID/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"videoUrl\": \"$PROJECT_ID\"}" || echo "{}")

echo "  Analyze response: $ANALYZE_RESPONSE"

ANALYSIS_JOB_ID=$(echo "$ANALYZE_RESPONSE" | grep -o '"analysisJobId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

if [ -n "$ANALYSIS_JOB_ID" ]; then
  pass "Analysis triggered (analysisJobId: $ANALYSIS_JOB_ID)"
else
  fail "Analysis trigger failed — no analysisJobId in response"
  echo "  Response: $ANALYZE_RESPONSE"
  exit 1
fi

# ── Step 4: Poll for completion ────────────────────────────
echo ""
echo "--- Step 4: Poll for clip-analysis completion ---"
MAX_WAIT=300  # 5 minutes
INTERVAL=5
ELAPSED=0
COMPLETED=false

while [ $ELAPSED -lt $MAX_WAIT ]; do
  JOB_STATUS=$(curl -sf "$API_URL/jobs/$ANALYSIS_JOB_ID" 2>/dev/null || echo '{"status":"UNKNOWN"}')

  STATUS=$(echo "$JOB_STATUS" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "UNKNOWN")
  PROGRESS=$(echo "$JOB_STATUS" | grep -o '"progress"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*: *//' || echo "0")

  echo "  [${ELAPSED}s] Status: $STATUS ($PROGRESS%)"

  case "$STATUS" in
    COMPLETED|completed)
      COMPLETED=true
      break
      ;;
    FAILED|failed)
      FAIL_REASON=$(echo "$JOB_STATUS" | grep -o '"failedReason"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "unknown")
      fail "Job failed: $FAIL_REASON"
      exit 1
      ;;
  esac

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ "$COMPLETED" = true ]; then
  pass "Clip-analysis completed in ${ELAPSED}s"
else
  fail "Clip-analysis timed out after ${MAX_WAIT}s"
  exit 1
fi

# ── Step 5: Verify clips ───────────────────────────────────
echo ""
echo "--- Step 5: Verify clips ---"
CLIPS_RESPONSE=$(curl -sf "$API_URL/projects/$PROJECT_ID/clips")

CLIP_COUNT=$(echo "$CLIPS_RESPONSE" | grep -o '"id"' | wc -l | tr -d ' ')
echo "  Clips found: $CLIP_COUNT"

if [ "$CLIP_COUNT" -gt 0 ]; then
  pass "Clips returned ($CLIP_COUNT clips)"
else
  fail "No clips returned"
  exit 1
fi

# ── Summary ────────────────────────────────────────────────
echo ""
echo "=========================================="
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo "=========================================="

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0

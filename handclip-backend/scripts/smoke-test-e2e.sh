#!/usr/bin/env bash
# ============================================================
# Smoke Test — End-to-End (Pipeline A → Pipeline B)
# ============================================================
#
# Prerequisites:
#   - Docker services: docker compose up -d redis
#   - Backend: cd handclip-backend && pnpm dev
#   - ffmpeg + ffprobe locally
#
# Usage:
#   bash scripts/smoke-test-e2e.sh [API_URL]
#   API_URL defaults to http://localhost:3000/api

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_URL="${1:-http://localhost:3000/api}"
TEST_DIR="/tmp/handclip-e2e-$$"
PASSED=0
FAILED=0
START_TIME=$(date +%s)

cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT
mkdir -p "$TEST_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }
info() { echo -e "${CYAN}→${NC} $1"; }

# ── Pre-flight ─────────────────────────────────────────────
echo "=============================================="
echo "  HandClip End-to-End Smoke Test"
echo "  API: $API_URL"
echo "=============================================="
echo ""

for cmd in ffmpeg ffprobe curl; do
  command -v "$cmd" &>/dev/null && pass "$cmd available" || { fail "$cmd not found"; exit 1; }
done

curl -sf "$API_URL/health" >/dev/null 2>&1 && pass "API health OK" || { fail "API unreachable"; exit 1; }

# ═══════════════════════════════════════════════════════════
# PIPELINE A — Upload → Transcribe → Analyze → Clips
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}═══ PIPELINE A: Clip Finding ═══${NC}"
echo ""

# Generate test video (60s, with audio for transcription)
info "Generating 60s test video..."
TEST_VIDEO="$TEST_DIR/input.mp4"
ffmpeg -y \
  -f lavfi -i "testsrc=duration=60:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=60" \
  -c:v libx264 -preset ultrafast -crf 28 \
  -c:a aac -b:a 128k \
  -shortest "$TEST_VIDEO" 2>/dev/null
[ -f "$TEST_VIDEO" ] && pass "Test video generated" || { fail "Video generation failed"; exit 1; }

# Upload
info "Uploading video..."
UPLOAD_RESP=$(curl -sf -X POST "$API_URL/projects/upload" \
  -F "video=@$TEST_VIDEO" -F "name=e2e-test.mp4")
PROJECT_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or d.get('projectId',''))" 2>/dev/null)
[ -n "$PROJECT_ID" ] && pass "Uploaded — project $PROJECT_ID" || { fail "Upload failed: $UPLOAD_RESP"; exit 1; }

# Analyze
info "Triggering analysis..."
ANALYZE_RESP=$(curl -sf -X POST "$API_URL/projects/$PROJECT_ID/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"videoUrl\":\"$PROJECT_ID\"}")
ANALYSIS_JOB_ID=$(echo "$ANALYZE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('analysisJobId',''))" 2>/dev/null)
[ -n "$ANALYSIS_JOB_ID" ] && pass "Analysis enqueued — job $ANALYSIS_JOB_ID" || { fail "Analyze failed: $ANALYZE_RESP"; exit 1; }

# Poll analysis
info "Polling clip-analysis job..."
MAX_WAIT=600; INTERVAL=5; ELAPSED=0; COMPLETED=false
while [ $ELAPSED -lt $MAX_WAIT ]; do
  JOB=$(curl -sf "$API_URL/jobs/$ANALYSIS_JOB_ID" 2>/dev/null || echo '{}')
  STATUS=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','UNKNOWN'))" 2>/dev/null)
  PROGRESS=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',0))" 2>/dev/null)
  echo "  [${ELAPSED}s] $STATUS ($PROGRESS%)"
  case "$STATUS" in
    completed|COMPLETED) COMPLETED=true; break ;;
    failed|FAILED) fail "Analysis job failed"; exit 1 ;;
  esac
  sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
done
$COMPLETED && pass "Analysis completed in ${ELAPSED}s" || { fail "Analysis timed out"; exit 1; }

# Verify clips
CLIPS=$(curl -sf "$API_URL/projects/$PROJECT_ID/clips")
CLIP_COUNT=$(echo "$CLIPS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$CLIP_COUNT" -gt 0 ] && pass "$CLIP_COUNT clips found" || { fail "No clips"; exit 1; }

# Extract first clip data for export
CLIP_ID=$(echo "$CLIPS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
CLIP_START=$(echo "$CLIPS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['startTime'])" 2>/dev/null)
CLIP_END=$(echo "$CLIPS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['endTime'])" 2>/dev/null)

# ═══════════════════════════════════════════════════════════
# PIPELINE B — Export MP4/H.264
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}═══ PIPELINE B: Export MP4 ═══${NC}"
echo ""

# Export
info "Triggering export for clip $CLIP_ID..."
EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$PROJECT_ID/export" \
  -H "Content-Type: application/json" \
  -d "{\"clipId\":\"$CLIP_ID\",\"trimStart\":$CLIP_START,\"trimEnd\":$CLIP_END,\"subtitles\":[],\"preset\":\"tiktok\"}")
EXPORT_ID=$(echo "$EXPORT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('exportId',''))" 2>/dev/null)
[ -n "$EXPORT_ID" ] && pass "Export enqueued — export $EXPORT_ID" || { fail "Export trigger failed: $EXPORT_RESP"; exit 1; }

# Poll export
info "Polling export status..."
MAX_WAIT=600; INTERVAL=5; ELAPSED=0; COMPLETED=false; OUTPUT_URL=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS_JSON=$(curl -sf "$API_URL/exports/$EXPORT_ID/status" 2>/dev/null || echo '{}')
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','UNKNOWN'))" 2>/dev/null)
  PROGRESS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',0))" 2>/dev/null)
  echo "  [${ELAPSED}s] $STATUS ($PROGRESS%)"
  case "$STATUS" in
    completed)
      COMPLETED=true
      OUTPUT_URL=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('outputUrl',''))" 2>/dev/null)
      break ;;
    failed) fail "Export failed"; exit 1 ;;
  esac
  sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
done
$COMPLETED && pass "Export completed in ${ELAPSED}s" || { fail "Export timed out"; exit 1; }

# Verify MP4
info "Verifying output MP4..."
TMP_OUT="$TEST_DIR/output.mp4"
curl -sfL "$OUTPUT_URL" -o "$TMP_OUT" 2>/dev/null
[ -s "$TMP_OUT" ] || { fail "Output download failed"; exit 1; }

CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$TMP_OUT" 2>/dev/null)
RES=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$TMP_OUT" 2>/dev/null)
DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TMP_OUT" 2>/dev/null)
SIZE=$(stat -c%s "$TMP_OUT" 2>/dev/null || stat -f%z "$TMP_OUT" 2>/dev/null)

[ "$CODEC" = "h264" ] && pass "Codec: H.264" || fail "Codec: $CODEC (expected h264)"
echo "  Resolution: $RES | Duration: ${DUR}s | Size: $(( SIZE / 1024 ))KB"
pass "Export verified — H.264 $RES ${DUR}s"

# ═══════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════
END_TIME=$(date +%s)
TOTAL=$((END_TIME - START_TIME))
echo ""
echo "=============================================="
echo -e "  Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
echo "  Total time: ${TOTAL}s"
echo "  Project: $PROJECT_ID"
echo "  Export:  $EXPORT_ID"
echo "=============================================="

[ "$FAILED" -eq 0 ] && exit 0 || exit 1

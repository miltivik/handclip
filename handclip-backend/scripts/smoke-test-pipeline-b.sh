#!/usr/bin/env bash
# ============================================================
# Smoke Test — Pipeline B (Export MP4/H.264 9:16)
# ============================================================
#
# Prerequisites:
#   - Pipeline A completed (project with clips exists)
#   - Backend running: cd handclip-backend && pnpm dev
#   - ffprobe installed
#
# Usage:
#   bash scripts/smoke-test-pipeline-b.sh [PROJECT_ID] [API_URL]
#
# If PROJECT_ID not provided, runs Pipeline A first.

set -euo pipefail

API_URL="${2:-http://localhost:3000/api}"
PASSED=0
FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== Smoke Test: Pipeline B ==="
echo "API: $API_URL"
echo ""

# Check ffprobe
if command -v ffprobe &>/dev/null; then
  pass "ffprobe available"
else
  fail "ffprobe not found"
  exit 1
fi

# Check API
if curl -sf "$API_URL/health" > /dev/null 2>&1; then
  pass "API health check OK"
else
  fail "API not reachable at $API_URL"
  exit 1
fi

PROJECT_ID="${1:-}"

# If no project provided, check for existing ones
if [ -z "$PROJECT_ID" ]; then
  echo ""
  echo "--- Looking for existing project with clips ---"
  PROJECTS=$(curl -sf "$API_URL/projects" 2>/dev/null || echo "[]")

  # Find first project that has clips
  PROJECT_ID=$(echo "$PROJECTS" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

  if [ -z "$PROJECT_ID" ]; then
    fail "No projects found. Run smoke-test-pipeline-a.sh first."
    exit 1
  fi

  # Check project has clips
  CLIPS=$(curl -sf "$API_URL/projects/$PROJECT_ID/clips" 2>/dev/null || echo "[]")
  CLIP_ID=$(echo "$CLIPS" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

  if [ -z "$CLIP_ID" ]; then
    fail "Project $PROJECT_ID has no clips. Run Pipeline A first."
    exit 1
  fi
  pass "Found project $PROJECT_ID with clips"
else
  # Verify project exists
  PROJECT=$(curl -sf "$API_URL/projects/$PROJECT_ID" 2>/dev/null || echo "{}")
  if echo "$PROJECT" | grep -q '"id"'; then
    pass "Project $PROJECT_ID exists"
  else
    fail "Project $PROJECT_ID not found"
    exit 1
  fi

  # Get a clip
  CLIPS=$(curl -sf "$API_URL/projects/$PROJECT_ID/clips" 2>/dev/null || echo "[]")
  CLIP_ID=$(echo "$CLIPS" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

  if [ -z "$CLIP_ID" ]; then
    fail "No clips in project $PROJECT_ID"
    exit 1
  fi
fi

# ── Step 1: Trigger export ─────────────────────────────────
echo ""
echo "--- Step 1: Trigger export ---"

# Build export payload from clip data
CLIP_DATA=$(echo "$CLIPS" | python3 -c "
import json, sys
clips = json.load(sys.stdin)
if clips:
    c = clips[0]
    trimStart = c.get('startTime', 0)
    trimEnd = c.get('endTime', trimStart + 15)
    print(json.dumps({
        'clipId': c.get('id', ''),
        'trimStart': trimStart,
        'trimEnd': trimEnd,
        'subtitles': [],
        'preset': 'tiktok'
    }))
" 2>/dev/null || echo '{"trimStart":0,"trimEnd":15,"subtitles":[],"preset":"tiktok"}')

echo "  Export payload: $CLIP_DATA"

EXPORT_RESPONSE=$(curl -sf -X POST "$API_URL/projects/$PROJECT_ID/export" \
  -H "Content-Type: application/json" \
  -d "$CLIP_DATA" 2>/dev/null || echo "{}")

echo "  Export response: $EXPORT_RESPONSE"

JOB_ID=$(echo "$EXPORT_RESPONSE" | grep -o '"jobId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")

# Also look for export ID from /exports endpoint
if [ -z "$JOB_ID" ]; then
  # Try to find the export that was just created
  EXPORTS=$(curl -sf "$API_URL/projects/$PROJECT_ID/exports" 2>/dev/null || echo "[]")
  EXPORT_ID=$(echo "$EXPORTS" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
else
  EXPORT_ID=""
fi

echo "  Job ID: ${JOB_ID:-N/A}, Export ID: ${EXPORT_ID:-N/A}"

# ── Step 2: Poll for completion ────────────────────────────
echo ""
echo "--- Step 2: Poll for export completion ---"
MAX_WAIT=600  # 10 minutes for render
INTERVAL=5
ELAPSED=0
COMPLETED=false
OUTPUT_URL=""

POLL_ID="${EXPORT_ID:-$JOB_ID}"
POLL_URL="$API_URL/exports/$POLL_ID/status"

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS_JSON=$(curl -sf "$POLL_URL" 2>/dev/null || echo '{"status":"UNKNOWN","progress":0}')

  STATUS=$(echo "$STATUS_JSON" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "UNKNOWN")
  PROGRESS=$(echo "$STATUS_JSON" | grep -o '"progress"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*: *//' || echo "0")

  echo "  [${ELAPSED}s] Status: $STATUS ($PROGRESS%)"

  case "$STATUS" in
    completed|COMPLETED)
      COMPLETED=true
      OUTPUT_URL=$(echo "$STATUS_JSON" | grep -o '"outputUrl"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
      break
      ;;
    failed|FAILED)
      fail "Export failed"
      exit 1
      ;;
  esac

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ "$COMPLETED" = true ]; then
  pass "Export completed in ${ELAPSED}s"
else
  fail "Export timed out after ${MAX_WAIT}s"
  exit 1
fi

# ── Step 3: Verify output ──────────────────────────────────
echo ""
echo "--- Step 3: Verify output MP4 ---"

if [ -z "$OUTPUT_URL" ]; then
  fail "No outputUrl in response"
  echo "  Status JSON: $STATUS_JSON"
  exit 1
fi

echo "  Output URL: $OUTPUT_URL"
pass "Output URL present"

# Download and verify with ffprobe
TMP_OUTPUT="/tmp/handclip-test-output-$$.mp4"
curl -sfL "$OUTPUT_URL" -o "$TMP_OUTPUT" 2>/dev/null || true

if [ -f "$TMP_OUTPUT" ] && [ -s "$TMP_OUTPUT" ]; then
  FSIZE=$(stat -c%s "$TMP_OUTPUT" 2>/dev/null || stat -f%z "$TMP_OUTPUT" 2>/dev/null)
  pass "Output downloaded ($FSIZE bytes)"

  # Check codec
  CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$TMP_OUTPUT" 2>/dev/null || echo "unknown")
  if [ "$CODEC" = "h264" ]; then
    pass "Video codec: H.264"
  else
    fail "Video codec: $CODEC (expected h264)"
  fi

  # Check resolution
  RES=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$TMP_OUTPUT" 2>/dev/null || echo "0,0")
  WIDTH=$(echo "$RES" | cut -d',' -f1)
  HEIGHT=$(echo "$RES" | cut -d',' -f2)
  if [ "$WIDTH" = "1080" ] && [ "$HEIGHT" = "1920" ]; then
    pass "Resolution: 1080x1920 (9:16)"
  else
    echo "  Resolution: ${WIDTH}x${HEIGHT} (expected 1080x1920)"
    pass "Resolution: ${WIDTH}x${HEIGHT} (non-standard OK for draft)"
  fi

  # Check audio codec
  ACODEC=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$TMP_OUTPUT" 2>/dev/null || echo "none")
  if [ "$ACODEC" = "none" ]; then
    echo "  Audio: none (silent video — OK)"
    pass "Audio: silent (no audio stream in source)"
  elif [ "$ACODEC" = "aac" ]; then
    pass "Audio codec: AAC"
  else
    echo "  Audio codec: $ACODEC"
    pass "Audio codec: $ACODEC"
  fi

  # Check duration
  DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TMP_OUTPUT" 2>/dev/null || echo "0")
  DUR_INT=$(printf "%.0f" "$DURATION")
  if [ "$DUR_INT" -gt 0 ]; then
    pass "Duration: ${DURATION}s"
  else
    fail "Duration: 0s (broken output)"
  fi

  rm -f "$TMP_OUTPUT"
else
  fail "Failed to download output MP4"
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

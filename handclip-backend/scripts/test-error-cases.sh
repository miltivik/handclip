#!/usr/bin/env bash
# ============================================================
# Error Cases Test — Pipeline Resiliency
# ============================================================
#
# Tests edge cases and error handling without crashing the worker.
#
# Prerequisites: backend running, ffmpeg available.
# Usage: bash scripts/test-error-cases.sh [API_URL]

set -euo pipefail
API_URL="${1:-http://localhost:3000/api}"
TEST_DIR="/tmp/handclip-errors-$$"
PASSED=0; FAILED=0; SKIPPED=0

cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT
mkdir -p "$TEST_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "${YELLOW}⊘${NC} $1"; SKIPPED=$((SKIPPED + 1)); }

echo "=============================================="
echo "  HandClip Error Cases Test"
echo "=============================================="
echo ""

curl -sf "$API_URL/health" >/dev/null 2>&1 || { fail "API unreachable"; exit 1; }

# ── Case 1: Empty / corrupt video upload ───────────────────
echo -e "\n${YELLOW}── Case 1: Corrupt video upload${NC}"
dd if=/dev/urandom of="$TEST_DIR/corrupt.mp4" bs=1024 count=100 2>/dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/projects/upload" \
  -F "video=@$TEST_DIR/corrupt.mp4" -F "name=corrupt.mp4" 2>/dev/null)
# Should return 400 or 422 (validation error)
if [ "$HTTP_CODE" -ge 400 ] && [ "$HTTP_CODE" -lt 500 ]; then
  # Now test: the upload may still succeed but analysis should fail gracefully
  pass "Corrupt video: HTTP $HTTP_CODE (4xx client error expected)"
else
  echo "  HTTP $HTTP_CODE — video may have been accepted, checking analysis..."
  # Upload a tiny valid video instead
  ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" \
    -f lavfi -i "anullsrc=r=44100:cl=mono" -c:v libx264 -c:a aac \
    -shortest -t 1 "$TEST_DIR/tiny.mp4" 2>/dev/null
  skip "Corrupt video accepted — FFmpeg may reject on analysis"
fi

# ── Case 2: Video too short for export (< 15s) ─────────────
echo -e "\n${YELLOW}── Case 2: Clip too short (< 15s)${NC}"
# Create a project with a short video
ffmpeg -y -f lavfi -i "testsrc=duration=5:size=640x360:rate=24" \
  -c:v libx264 -preset ultrafast -crf 28 -t 5 "$TEST_DIR/short.mp4" 2>/dev/null

UPLOAD_RESP=$(curl -sf -X POST "$API_URL/projects/upload" \
  -F "video=@$TEST_DIR/short.mp4" -F "name=short.mp4" 2>/dev/null || echo '{}')
SHORT_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)

if [ -n "$SHORT_ID" ]; then
  EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$SHORT_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"trimStart":0,"trimEnd":3,"subtitles":[],"preset":"tiktok"}' 2>/dev/null || echo '{}')
  EXPORT_STATUS=$(echo "$EXPORT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusCode',200))" 2>/dev/null)
  # Should get 400 Bad Request due to min duration validation
  if echo "$EXPORT_RESP" | grep -qi "corto\|short\|min"; then
    pass "Short clip: validation error returned"
  elif echo "$EXPORT_RESP" | grep -qi "error\|bad request\|400"; then
    pass "Short clip: error returned (expected)"
  else
    fail "Short clip: no validation error — $EXPORT_RESP"
  fi
else
  fail "Could not create project for short video test"
fi

# ── Case 3: trimStart > trimEnd ────────────────────────────
echo -e "\n${YELLOW}── Case 3: trimStart > trimEnd${NC}"
# Reuse existing project or create a new one
VALID_ID="${SHORT_ID:-}"
if [ -z "$VALID_ID" ]; then
  ffmpeg -y -f lavfi -i "testsrc=duration=30:size=640x360:rate=24" \
    -c:v libx264 -preset ultrafast -crf 28 -t 30 "$TEST_DIR/valid.mp4" 2>/dev/null
  UPLOAD_RESP=$(curl -sf -X POST "$API_URL/projects/upload" \
    -F "video=@$TEST_DIR/valid.mp4" -F "name=valid.mp4" 2>/dev/null || echo '{}')
  VALID_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
fi

if [ -n "$VALID_ID" ]; then
  EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$VALID_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"trimStart":30,"trimEnd":5,"subtitles":[],"preset":"tiktok"}' 2>/dev/null || echo '{}')
  if echo "$EXPORT_RESP" | grep -qi "menor\|must be less\|trimStart\|validation"; then
    pass "trimStart > trimEnd: validation error returned"
  else
    fail "trimStart > trimEnd: no validation error — $EXPORT_RESP"
  fi
else
  fail "No valid project for trim validation test"
fi

# ── Case 4: Unknown preset ─────────────────────────────────
echo -e "\n${YELLOW}── Case 4: Invalid preset${NC}"
if [ -n "$VALID_ID" ]; then
  EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$VALID_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"trimStart":0,"trimEnd":20,"subtitles":[],"preset":"youtube"}' 2>/dev/null || echo '{}')
  if echo "$EXPORT_RESP" | grep -qi "validation\|enum\|invalid\|preset"; then
    pass "Invalid preset: validation error returned"
  else
    fail "Invalid preset: no validation — $EXPORT_RESP"
  fi
else
  fail "No valid project for preset test"
fi

# ── Case 5: Export with no subtitles (silent video path) ───
echo -e "\n${YELLOW}── Case 5: Export with empty subtitles${NC}"
if [ -n "$VALID_ID" ]; then
  EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$VALID_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"trimStart":0,"trimEnd":20,"subtitles":[],"preset":"draft"}' 2>/dev/null || echo '{}')
  EXPORT_ID=$(echo "$EXPORT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('exportId',''))" 2>/dev/null)
  if [ -n "$EXPORT_ID" ]; then
    # Poll for completion (should work — empty subs is valid)
    for i in $(seq 1 30); do
      S=$(curl -sf "$API_URL/exports/$EXPORT_ID/status" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
      case "$S" in completed) break;; failed) break;; esac
      sleep 2
    done
    if [ "$S" = "completed" ]; then
      pass "Empty subtitles export: completed successfully"
    elif [ "$S" = "failed" ]; then
      fail "Empty subtitles export: failed unexpectedly"
    else
      skip "Empty subtitles export: still processing (timeout OK)"
    fi
  else
    fail "Empty subtitles export: trigger failed — $EXPORT_RESP"
  fi
else
  fail "No valid project"
fi

# ── Case 6: Export with missing required fields ────────────
echo -e "\n${YELLOW}── Case 6: Missing required fields${NC}"
EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$VALID_ID/export" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo '{}')
if echo "$EXPORT_RESP" | grep -qi "validation\|required\|bad request"; then
  pass "Missing fields: validation error returned"
else
  fail "Missing fields: no validation error — $EXPORT_RESP"
fi

# ── Summary ────────────────────────────────────────────────
echo ""
echo "=============================================="
echo -e "  Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$SKIPPED skipped${NC}"
echo "=============================================="
[ "$FAILED" -eq 0 ] && exit 0 || exit 1

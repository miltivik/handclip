#!/usr/bin/env bash
# ============================================================
# Performance Benchmark — Pipeline Latency & Output Metrics
# ============================================================
#
# Measures:
#   - Pipeline A latency: upload → clips ready
#   - Pipeline B latency: export trigger → MP4 ready
#   - FFmpeg encoding speed (real-time factor)
#   - Output file size vs duration
#
# Prerequisites: backend running, ffmpeg + ffprobe available.
# Usage: bash scripts/benchmark.sh [API_URL]

set -euo pipefail
API_URL="${1:-http://localhost:3000/api}"
TEST_DIR="/tmp/handclip-bench-$$"
BENCH_DURATION=30  # seconds for test video

cleanup() { rm -rf "$TEST_DIR"; }
trap cleanup EXIT
mkdir -p "$TEST_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

echo "=============================================="
echo "  HandClip Performance Benchmark"
echo "  Test video: ${BENCH_DURATION}s"
echo "=============================================="
echo ""

curl -sf "$API_URL/health" >/dev/null 2>&1 || { echo "API unreachable"; exit 1; }

# ── Generate test video ────────────────────────────────────
echo -e "${CYAN}→${NC} Generating ${BENCH_DURATION}s test video..."
ffmpeg -y \
  -f lavfi -i "testsrc=duration=${BENCH_DURATION}:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=${BENCH_DURATION}" \
  -c:v libx264 -preset ultrafast -crf 28 \
  -c:a aac -b:a 128k \
  -shortest "$TEST_DIR/input.mp4" 2>/dev/null
echo "  Input: $(du -h "$TEST_DIR/input.mp4" | cut -f1)"

# ═══════════════════════════════════════════════════════════
# PIPELINE A BENCHMARK
# ═══════════════════════════════════════════════════════════
echo -e "\n${CYAN}═══ Pipeline A: Upload → Clips Ready ═══${NC}"

A_START=$(date +%s.%N)

# Upload
UPLOAD_RESP=$(curl -sf -X POST "$API_URL/projects/upload" \
  -F "video=@$TEST_DIR/input.mp4" -F "name=bench.mp4")
PROJECT_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
A_UPLOAD=$(echo "$(date +%s.%N) - $A_START" | bc)

# Analyze
ANALYZE_RESP=$(curl -sf -X POST "$API_URL/projects/$PROJECT_ID/analyze" \
  -H "Content-Type: application/json" -d "{\"videoUrl\":\"$PROJECT_ID\"}")
ANALYSIS_JOB_ID=$(echo "$ANALYZE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('analysisJobId',''))" 2>/dev/null)

# Poll until complete
MAX_WAIT=600; INTERVAL=2; ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  JOB=$(curl -sf "$API_URL/jobs/$ANALYSIS_JOB_ID" 2>/dev/null || echo '{}')
  STATUS=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','UNKNOWN'))" 2>/dev/null)
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
done
A_ANALYZE=$ELAPSED
A_TOTAL=$(echo "$(date +%s.%N) - $A_START" | bc)

CLIPS=$(curl -sf "$API_URL/projects/$PROJECT_ID/clips")
CLIP_COUNT=$(echo "$CLIPS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)

echo "  Upload time:    ${A_UPLOAD}s"
echo "  Analysis time:  ${A_ANALYZE}s"
echo "  Pipeline A total: ${A_TOTAL}s"
echo "  Clips found:    $CLIP_COUNT"

# ═══════════════════════════════════════════════════════════
# PIPELINE B BENCHMARK
# ═══════════════════════════════════════════════════════════
echo -e "\n${CYAN}═══ Pipeline B: Export MP4 ═══${NC}"

if [ "$CLIP_COUNT" -eq 0 ]; then
  echo "  No clips — skipping export benchmark"
  exit 0
fi

# Get first clip boundaries
CLIP_ID=$(echo "$CLIPS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
CLIP_START=$(echo "$CLIPS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['startTime'])" 2>/dev/null)
CLIP_END=$(echo "$CLIPS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['endTime'])" 2>/dev/null)

B_START=$(date +%s.%N)

EXPORT_RESP=$(curl -sf -X POST "$API_URL/projects/$PROJECT_ID/export" \
  -H "Content-Type: application/json" \
  -d "{\"clipId\":\"$CLIP_ID\",\"trimStart\":$CLIP_START,\"trimEnd\":$CLIP_END,\"subtitles\":[],\"preset\":\"tiktok\"}")
EXPORT_ID=$(echo "$EXPORT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('exportId',''))" 2>/dev/null)

MAX_WAIT=600; INTERVAL=2; ELAPSED=0; OUTPUT_URL=""
while [ $ELAPSED -lt $MAX_WAIT ]; do
  S=$(curl -sf "$API_URL/exports/$EXPORT_ID/status" 2>/dev/null || echo '{}')
  STATUS=$(echo "$S" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','UNKNOWN'))" 2>/dev/null)
  if [ "$STATUS" = "completed" ]; then
    OUTPUT_URL=$(echo "$S" | python3 -c "import sys,json; print(json.load(sys.stdin).get('outputUrl',''))" 2>/dev/null)
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "  Export failed"; exit 1
  fi
  sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
done
B_TOTAL=$(echo "$(date +%s.%N) - $B_START" | bc)

# Download and measure output
curl -sfL "$OUTPUT_URL" -o "$TEST_DIR/output.mp4" 2>/dev/null
OUTPUT_SIZE=$(stat -c%s "$TEST_DIR/output.mp4" 2>/dev/null || stat -f%z "$TEST_DIR/output.mp4" 2>/dev/null)
OUTPUT_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TEST_DIR/output.mp4" 2>/dev/null)
CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$TEST_DIR/output.mp4" 2>/dev/null)
RES=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$TEST_DIR/output.mp4" 2>/dev/null)

# Calculate metrics
CLIP_DURATION=$(echo "$CLIP_END - $CLIP_START" | bc)
RTF=$(echo "scale=2; $CLIP_DURATION / $B_TOTAL" | bc 2>/dev/null || echo "N/A")
BITRATE=$(echo "scale=1; ($OUTPUT_SIZE * 8) / ($OUTPUT_DURATION * 1000000)" | bc 2>/dev/null || echo "N/A")

echo "  Export time:    ${B_TOTAL}s"
echo "  Real-time factor: ${RTF}x (higher = faster)"
echo "  Output:         $CODEC $RES ${OUTPUT_DURATION}s"
echo "  Output size:    $(( OUTPUT_SIZE / 1024 ))KB"
echo "  Bitrate:        ${BITRATE}Mbps"

# ═══════════════════════════════════════════════════════════
# SUMMARY TABLE
# ═══════════════════════════════════════════════════════════
echo ""
echo "=============================================="
echo "  BENCHMARK SUMMARY"
echo "=============================================="
printf "  %-25s %10s\n" "Metric" "Value"
printf "  %-25s %10s\n" "-------------------------" "----------"
printf "  %-25s %10s\n" "Pipeline A (upload→clips)" "${A_TOTAL}s"
printf "  %-25s %10s\n" "Pipeline B (export)" "${B_TOTAL}s"
printf "  %-25s %10s\n" "Clips found" "$CLIP_COUNT"
printf "  %-25s %10s\n" "Output resolution" "$RES"
printf "  %-25s %10s\n" "Output codec" "$CODEC"
printf "  %-25s %10s\n" "Output size" "$(( OUTPUT_SIZE / 1024 ))KB"
printf "  %-25s %10s\n" "Encoding speed" "${RTF}x"
printf "  %-25s %10s\n" "Bitrate" "${BITRATE}Mbps"
echo "=============================================="

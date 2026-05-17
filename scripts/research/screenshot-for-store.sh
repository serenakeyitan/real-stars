#!/bin/bash
# Convert any PNG/JPEG to a Chrome Web Store-compatible 1280x800 PNG.
#
# Strategy: aspect-FILL (not fit). Scale so the canvas fills exactly,
# then center-crop the overflow. No letterbox bars.
#
# Usage:
#   ./scripts/screenshot-for-store.sh ~/Desktop/foo.png
#   ./scripts/screenshot-for-store.sh ~/Desktop/*.png    # batch
#
# Uses macOS sips (built in). No dependencies.

set -e

OUT_DIR="store-screenshots"
mkdir -p "$OUT_DIR"

if [ $# -eq 0 ]; then
  echo "usage: $0 <image1.png> [image2.png ...]"
  exit 1
fi

TARGET_W=1280
TARGET_H=800

for src in "$@"; do
  if [ ! -f "$src" ]; then
    echo "skip: $src (not a file)"
    continue
  fi

  base=$(basename "$src")
  name="${base%.*}"
  dest="$OUT_DIR/${name}-1280x800.png"
  tmp="$OUT_DIR/${name}.tmp.png"

  w=$(sips -g pixelWidth "$src" | awk '/pixelWidth:/ {print $2}')
  h=$(sips -g pixelHeight "$src" | awk '/pixelHeight:/ {print $2}')

  echo "$base: ${w}x${h} → ${TARGET_W}x${TARGET_H}"

  # Aspect-FILL: scale so neither dimension ends up smaller than target,
  # then center-crop excess.
  src_ratio_x100=$(echo "$w * 100 / $h" | bc)
  target_ratio_x100=$((TARGET_W * 100 / TARGET_H))  # = 160

  if [ "$src_ratio_x100" -gt "$target_ratio_x100" ]; then
    # source WIDER than target → fix height to 800, width overflows → crop
    sips --resampleHeight $TARGET_H "$src" --out "$tmp" >/dev/null
  else
    # source TALLER than target → fix width to 1280, height overflows → crop
    sips --resampleWidth $TARGET_W "$src" --out "$tmp" >/dev/null
  fi

  # Center-crop to exactly TARGET_W x TARGET_H
  sips -c $TARGET_H $TARGET_W "$tmp" --out "$dest" >/dev/null

  # Strip alpha (Chrome Web Store rejects 32-bit PNGs)
  sips -s format png -s formatOptions normal "$dest" --out "$dest" >/dev/null

  rm -f "$tmp"

  final_w=$(sips -g pixelWidth "$dest" | awk '/pixelWidth:/ {print $2}')
  final_h=$(sips -g pixelHeight "$dest" | awk '/pixelHeight:/ {print $2}')
  size=$(ls -lh "$dest" | awk '{print $5}')
  echo "  → $dest (${final_w}x${final_h}, $size)"
done

echo ""
echo "Done. Upload from: $OUT_DIR/"

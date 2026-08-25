#!/usr/bin/env bash
# Rebuilds the two shipped film masters from the three source films.
#
# Why one master per tier instead of three films:
#   Three <video> elements meant three live decoders, three network connections and three copies of
#   a decoded frame buffer in VRAM. One master holds one decoder, and the act seams become baked
#   cross-dissolves instead of a JS opacity blend between two frozen boundary frames.
#
# Why H.264 and not AV1/VP9:
#   Scroll scrubbing is seek-bound, not bandwidth-bound. H.264 is the only codec with hardware
#   decode on effectively every device that will ever open this page; a software AV1 decode path
#   would halve the bytes and ruin the scrub on exactly the mid-range phones this targets.
#
# Why these encoder settings:
#   -g 12          keyframe every half second. Measured: g=24 saves only 5% but doubles worst-case
#                  seek decode depth, and the whole experience is random-seek.
#   -bf 0          no B-frames. Decode order == display order keeps requestVideoFrameCallback
#                  gating honest and costs little here (see below).
#   scenecut=0     fixed GOP, so seek cost is predictable rather than content-dependent.
#   aq-mode=3      the films are near-black night footage; variance AQ keeps the crowd out of banding.
#   -crf 25        measured against a CRF 10 reference of the same cut: VMAF 96.6 (1280) / 92.9 (960).
#                  The shipped 960 tier scored 94.0 before this change at 2.75x the bytes.
#   No denoise     tested hqdn3d at four strengths; every setting lost more VMAF than it saved bytes.
#                  The content is genuinely detailed (a crowd of thousands), not noisy.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=${SRC:-media-src}
OUT=public/video

if [ ! -d "$SRC" ]; then
  echo "Source films not found in $SRC/. Set SRC=<dir> containing the three festival_0*.mp4 films." >&2
  exit 1
fi

# 0.5s dissolves land the act seams at 9.75s and 19.25s of a 29s master, i.e. within 0.4% of the
# scroll positions the previous three-file build blended at.
FILTER="[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[a];[a][2:v]xfade=transition=fade:duration=0.5:offset=19.0,fps=24[v]"

encode() {
  local width=$1 height=$2 level=$3
  echo "→ ${width}x${height}"
  ffmpeg -y -hide_banner -loglevel error \
    -i "$SRC/festival_01_logo_to_stage.mp4" \
    -i "$SRC/festival_02_crowd_flight.mp4" \
    -i "$SRC/festival_03_grand_finale.mp4" \
    -filter_complex "$FILTER;[v]scale=${width}:${height}:flags=lanczos,format=yuv420p[out]" \
    -map "[out]" -an \
    -c:v libx264 -preset veryslow -crf 25 \
    -g 12 -keyint_min 12 -bf 0 \
    -x264-params "scenecut=0:open-gop=0:aq-mode=3:aq-strength=0.9" \
    -profile:v high -level "$level" -pix_fmt yuv420p \
    -movflags +faststart \
    "$OUT/festival-master-${width}.mp4"
}

mkdir -p "$OUT"
encode 1280 720 4.0
encode 960 540 3.1

# The soundtrack only loads when the visitor asks for it, but 190 kbps stereo is well past the point
# where a looping ambient bed benefits. 128 kbps VBR is transparent for this material.
if [ -f "$SRC/neon-skyfall.mp3" ]; then
  ffmpeg -y -hide_banner -loglevel error -i "$SRC/neon-skyfall.mp3" \
    -c:a libmp3lame -q:a 5 -ar 44100 public/audio/neon-skyfall.mp3
fi

# The opening poster has to be frame 0 of the master, or the loader hands over to a visible jump.
ffmpeg -y -hide_banner -loglevel error -i "$OUT/festival-master-1280.mp4" \
  -frames:v 1 -c:v libwebp -quality 82 -compression_level 6 public/reference/01_opening_logo.webp

ls -l "$OUT"

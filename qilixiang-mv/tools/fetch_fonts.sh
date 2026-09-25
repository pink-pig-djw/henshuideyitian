#!/usr/bin/env bash
# Download the three open-source (SIL OFL) fonts used by the MV into assets/fonts/.
set -euo pipefail
cd "$(dirname "$0")/../assets" && mkdir -p fonts && cd fonts
G=https://raw.githubusercontent.com/google/fonts/main/ofl
[ -f MaShanZheng-Regular.ttf ] || curl -fsSLO "$G/mashanzheng/MaShanZheng-Regular.ttf"
[ -f LongCang-Regular.ttf ] || curl -fsSLO "$G/longcang/LongCang-Regular.ttf"
[ -f LXGWWenKai-Medium.ttf ] || curl -fsSL -o LXGWWenKai-Medium.ttf \
  https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Medium.ttf
ls -la

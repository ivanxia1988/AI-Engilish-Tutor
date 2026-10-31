#!/usr/bin/env bash
# Render reference HTML (and the mascot sheet) to PNG with headless Chrome, then trim trailing empty background.
set -e
cd "$(dirname "$0")"
shot(){ timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --force-device-scale-factor=${4:-2} --window-size=$2,$3 --screenshot=mockups/$1.png "file://$PWD/$5" >/dev/null 2>&1; }
shot landing-desktop-1440 1440 3200 2 reference/landing.html
shot landing-mobile-390   390 5200 2 reference/landing.html
shot lessons-desktop-1440 1440 900 2 reference/lessons.html
shot lessons-mobile-390   390 844 3 reference/lessons.html
shot study-desktop-1440   1440 900 2 reference/study.html
shot study-mobile-390     390 844 3 reference/study.html
shot components-states    1440 2200 2 reference/components.html
python3 - <<'PY'
from PIL import Image
for p,pad in [('mockups/landing-desktop-1440.png',0),('mockups/landing-mobile-390.png',0),('mockups/components-states.png',80),('mockups/lessons-mobile-390.png',0)]:
    im=Image.open(p).convert('RGB'); w,h=im.size
    bg=im.getpixel((w//2,h-3)); y=h-1
    while y>0 and all(im.getpixel((x,y))==bg for x in range(0,w,7)): y-=1
    im.crop((0,0,w,min(h,y+1+pad))).save(p); print(p,(w,h),'->',y+1+pad)
PY
# mascot sheet (needs the mascot SVGs built first: python3 mascot/build_mascot.py)
timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1600,2000 --screenshot=mascot/teeko-mascot-sheet.png "file://$PWD/mascot/sheet.html" >/dev/null 2>&1
python3 - <<'PY'
from PIL import Image, ImageChops
p='mascot/teeko-mascot-sheet.png'; im=Image.open(p).convert('RGB'); bg=Image.new('RGB',im.size,(251,248,242))
b=ImageChops.difference(im,bg).getbbox(); im.crop((0,0,b[2]+80,b[3]+80)).save(p); print(p,'ok')
PY
# v0.3 — iPad lesson-screen states (1194×834 @2x) + overview sheet
bash ipad/render_ipad.sh
timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --force-device-scale-factor=1.5 --window-size=1848,1545 --screenshot="$PWD/ipad/overview.png" "file://$PWD/ipad/overview.html" >/dev/null 2>&1; echo ipad/overview.png

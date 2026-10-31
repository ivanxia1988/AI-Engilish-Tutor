#!/bin/bash
# Renders the iPad lesson-screen states at 1194×834 (@2x PNG = 2388×1668)
cd "$(dirname "$0")"
shot(){ timeout 40 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=3000 --force-device-scale-factor=2 --window-size=1194,834 --screenshot="$PWD/$2.png" "file://$PWD/lesson.html?s=$1" >/dev/null 2>&1; echo "$2.png"; }
shot 06 06-teeko-speaking
shot 07 07-your-turn
shot 08 08-thinking
shot 09 09-stuck-scaffolding
shot 10 10-pronunciation
shot 11 11-child-left-frame
shot 18 18-pause-menu
shot listening x-child-talking
shot reconnecting x-reconnecting

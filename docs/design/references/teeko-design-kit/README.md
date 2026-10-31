# Teeko design kit v0.3 (ages 10–12 · iPad landscape 1194×834 · Teeko = AI teacher · free v1 · built-in courseware)
Start with `CODEX_PROMPT.md`, then `DESIGN.md`.
- Tokens: `python3 build_tokens.py` → tokens.css, tokens.json, tailwind.preset.js, contrast.json
- Mascot: `python3 mascot/build_mascot.py` → mascot/svg/*.svg, head icons; open `mascot/sheet.html` (turnaround, poses, visemes, loop frames) and `mascot/talking-demo.html` (lip-sync demo)
- Mockups + mascot sheet PNG: `./render.sh` (needs google-chrome, Pillow, fonts Nunito, Inter, Noto Sans CJK SC, JetBrains Mono)
- iPad lesson screen: `ipad/lesson.html?s=06|07|08|09|10|11|18|listening|reconnecting` → `bash ipad/render_ipad.sh` (2388×1668 PNGs) · overview sheet `ipad/overview.html` → `ipad/overview.png` (both also run by `./render.sh`)
- Pages: `reference/landing.html` (parents, Chinese), `reference/lessons.html`, `reference/study.html`, `reference/components.html`

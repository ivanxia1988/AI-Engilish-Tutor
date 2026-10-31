# Prompt for Codex — build teeko.app from this design kit (v0.3)

You are building **teeko.app**: spoken English for **Chinese kids aged 10–12** (the look must not be childish). The primary kid surface is an **iPad landscape lesson screen (1194×834)**; parents read the web landing page (Chinese). **Teeko the sparrow is the AI teacher** (there is no other teacher character): it reads and marks the built-in textbook page, hands the kid the turn, listens and scaffolds. The lesson screen shows only three things — textbook page, Teeko avatar (top right), child window (bottom right) — and is voice-driven (“Again” / “Slower” / “中文”), with no subtitles bar and no big buttons. **v1 is free**: build no pricing, plans, paywalls, editions, uploads or textbook import.

## Read in this order
1. `DESIGN.md` — the spec. It overrides everything else.
2. `ipad/*.png` + `ipad/overview.png` — **the iPad lesson screen states (06 speaking, 07 your turn, 08 thinking, 09 stuck, 10 pronunciation, 11 left frame, 18 pause menu, + child talking, reconnecting)**; markup in `ipad/lesson.html?s=<state>`, spec in DESIGN.md §7.9 / §10.4.
3. `mockups/*.png` — landing (desktop/mobile), lessons (desktop/mobile), study (desktop/mobile), component states.
4. `reference/*.html` + `reference/components.css` — working markup for every component and page. Port it; don't redesign it.
5. `mascot/` — all mascot SVGs, `talking-demo.html` (lip-sync reference), `teeko-mascot-sheet.png`.
6. `tokens.css` / `tokens.json` / `tailwind.preset.js` — design tokens.

## Rules
- **Tokens only.** Import `tokens.css` once; Tailwind: `presets: [require('./tailwind.preset.js')]`. No hard-coded hex/px outside tokens (exception: lesson-art colors inside lesson content). New value → edit `build_tokens.py`, run `python3 build_tokens.py`, commit outputs.
- **Fonts:** Nunito 800/900 (display, kid buttons), Inter (UI/body), Noto Sans SC (Chinese), JetBrains Mono (small labels). Self-host, `font-display: swap`.
- **Tap targets (v0.3):** ≥44px (iPad HIG), 56px for primary actions (pause menu, 开始). Web mic 80px.
- **iPad lesson screen (v0.3):** `LessonScreen` = `TextbookPage` + `TeekoAvatar status="speaking|waiting|thinking|paused|reconnecting"` + `ChildWindow status="idle|turn|listening|away"` + `ProgressLine` + `CornerPauseIcon` + `PauseMenu`. Page marks (`reading`, `currentWord`, `target`, `stuck`+choices, `wavy`+tag) are absolutely positioned overlays that never reflow the page. Status = colour **and** shape/motion (DESIGN.md §7.9). No subtitle bar, no quick buttons, no text label next to Teeko; voice commands Again / Slower / 中文.
- **Mascot:** a `<Mascot pose="idle|talking|handoff|thinking|celebrate" />` component that inlines the SVGs from `mascot/svg/pose-*.svg` (inline so CSS can reach `.mouth-slot`, `.eyes-*`, `.wing-*`). Talking uses `<MascotLipSync audio={...}>` built from `teeko-rig-front.svg` + the driver in DESIGN.md §6.3 (80ms RMS sampling, thresholds 0.08 / 0.32, hold ≥80ms, `oo` from phoneme hints). Without audio use `teeko-talking-loop.svg`. Never redraw or recolor the mascot.
- **Mic (web only)** is one component with `state: 'idle'|'turn'|'listening'|'processing'|'disabled'` (DESIGN.md §7.2); each state maps to a mascot pose. Handoff = 640ms spring + reduced-motion fallback.
- **Feedback = stars (1–3) + per-word `.say` + one Chinese tip.** No numeric scores, no red, never 0 stars.
- **Colors:** one orange-filled element per view; never white text on orange; mascot orange is artwork, not UI.
- **Copy:** Chinese instructions for kids (short, ≤16 characters), English for lesson content. Landing copy in Chinese for parents. Placeholder text is marked in the mockups (`.ph`) — keep it flagged until product confirms.
- **Accessibility** (DESIGN.md §9) is acceptance criteria: focus rings, aria-live state announcements, captions available (off by default on iPad, toggle in pause menu), `prefers-reduced-motion`, no auto mic request on load.

## Suggested build order
1. Tokens + fonts; `Logo`, `Button`, `Chip`, `Card`, `Stars`, `Say`, `SpeechBubble`, `Seg`, `MicButton`, `Mascot`, `MascotLipSync`; a `/styleguide` route matching `mockups/components-states.png`.
2. Landing `/` (§10.1), responsive.
3. Lessons `/learn` (§10.2) reading a static JSON of built-in units/lessons.
4. Study `/learn/[unit]/[lesson]` (§10.3): lesson page with 点一点/圈一圈, rail, dock, mobile sheet; wire the mic + mascot state machine to a mock voice service first, then the realtime voice API.
5. Visual QA at 1440×900 and 390×844 against `mockups/`.

## Don't
- No pricing, editions, upload/import, Chinese-for-foreigners, leaderboards, streaks, ads or external links on kid screens.
- No gradients, glass, new illustration styles or new colors.
- Don't idle-animate the mascot beyond the blink.

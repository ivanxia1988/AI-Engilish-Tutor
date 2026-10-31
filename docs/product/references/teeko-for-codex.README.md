# Teeko（teeko.app）给 Codex 的资料包

导出日期：2026-10-30（Asia/Shanghai）
产品：10–12 岁中国孩子的 AI 英语老师，iPad 横屏（1194×834）。橙色小麻雀 Teeko 是唯一的 AI 老师。v1 免费。

## 阅读顺序

1. `PRD.md`：产品需求（Teeko PRD v0.2）。决定**做什么**、范围（P0 / P1 / P2）、页面流、AI 老师规则、OpenAI Live 委派方案。
   来源 Page：https://cursor.com/canvas/store-501c52db-ffc2-4473-9ad6-d616e628f7dc/025810fa-f53e-4873-8d9e-f000f3ecdc0d
2. `design_kit/DESIGN.md`：视觉规范 v0.3。决定**长什么样**（颜色、字体、组件、Teeko 形象、iPad 上课画面状态）。
3. `design_kit/CODEX_PROMPT.md`：给 Codex 的构建说明和建议顺序。
4. Tokens：`design_kit/tokens.css`、`design_kit/tokens.json`、`design_kit/tailwind.preset.js`（由 `design_kit/build_tokens.py` 生成，改值请改脚本再重新生成）。
5. iPad 效果图：`design_kit/ipad/`（06 Teeko 在讲、07 轮到你、08 在想、09 卡住给提示、10 发音、11 离开画面、18 暂停菜单、x-child-talking、x-reconnecting、overview.png；页面源码 `ipad/lesson.html`）。
   其余参考：`design_kit/mockups/`、`design_kit/reference/`、`design_kit/mascot/`、`design_kit/assets/`。

## 冲突时听谁的

- 产品范围、页面、流程、规则：以 `PRD.md` 为准。
- 视觉（颜色、字号、组件、动效、Teeko 形象）：以 `design_kit/DESIGN.md` 为准。
- 上课画面（iPad）不显示星星和分数，只有三样东西：课本页、Teeko、孩子小窗。字幕默认关，在暂停菜单里打开。星星只用在课后小结等课外页面，最终要不要保留，见 PRD「待夏诚决定」。

## 注意

- **/workspace/flow/v3/ 里的 29 张页面流旧图没有放进本包。** 这些图只能参考布局，里面是旧名字和旧配色，不要照着做名字、颜色和文字。PRD 里提到它们时也是这个意思。
- **课本页是占位内容。** 效果图里的「Unit 3 · Weekend plans」等课本内容只是示意，不是真实课件；正式课件由内部制作流程产出（见 PRD「6 课件制作流程」）。
- 旧 Figma 帧（v0.1）已废弃，不要照着做。
- PRD 里标「未核实」「待视觉确认」「待夏诚决定」的内容还没定，实现时做成可配置，或先留 TODO。
- 本包不含任何 API key 或环境变量值。需要 key 时从你自己的环境变量读，不要写进代码或提交。
- `PRD.md` 是从 Page 自动转换的：引用块开头的 [info] / [warning] / [success] 是提示框颜色；表格格子后面的 [success] / [warning] / [danger] 是该格颜色（绿 / 黄 / 红）；「图（节点）/ 图（连线）」是流程图。

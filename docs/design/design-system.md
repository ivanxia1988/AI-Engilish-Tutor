# Teeko 全局设计规范：项目适配索引

此文件提炼 `teeko_for_codex.zip` 中 DESIGN v0.3，帮助在现有代码中定位实现工作。产品需求见 [SPEC](../specs/teeko-v1/spec.md)，完整视觉数值以 [DESIGN.md](references/teeko-design-kit/DESIGN.md) 为依据。

## 视觉基线

| 项目 | 原包规范 | 实现参考 |
|---|---|---|
| 视觉语气 | 温暖、克制、不幼稚；家长中文首页，儿童英文学习内容 | DESIGN §0、§11；目标 10–12 岁。 |
| 页面与文字 | 奶油白背景、白色卡片、深蓝主文字 | `--tk-bg-*`、`--tk-text-*` 语义 tokens。 |
| 强调与状态 | 橙色用于轮到用户或主要强调；青绿色用于实时状态、链接和焦点 | DESIGN §2；吉祥物专用色与 UI 色分开，课程插画色仅用于课程内容。 |
| 字体 | Nunito 用于标题，Inter 用于正文；中文使用独立回退字体 | DESIGN §3；原包只附 Nunito Black 及其 OFL 许可。 |
| 间距与形状 | 4px 间距体系；圆角收紧为 4/8/12/16/20px；触达目标间距至少 12px | DESIGN §3、§4、§8；替代旧版 26px 儿童卡片。 |
| 操作尺寸 | 触达至少 44px、主要操作 56px；角落按钮可为 40px 视觉尺寸加触达扩展 | DESIGN §4；80px 麦克风仅用于旧 Web，iPad 课中不放大麦克风按钮。 |
| iPad 核心布局 | 1194×834；课本、右上 168px Teeko 圆盘、右下 232×174 孩子小窗 | DESIGN §7.9、§10.4；孩子窗口默认头像。 |
| 图标与品牌 | Lucide 线宽 1.75，儿童界面较大图标使用 2；全身矢量雀鸟 | DESIGN §5、§6；素材及嘴型见 [吉祥物说明](mascot.md)。 |
| 无障碍 | 可见焦点、状态播报、键盘操作、减少动画 | DESIGN §9；权限由明确操作触发。 |

## 组件与状态

- 2026-10-31 用户标注：页面文案只保留帮助理解或完成操作的信息，移除重复口号、无用引导语、内部账号规则说明；模拟登录等审阅快捷入口放在原型外层工具，不混入正式产品表单。必要的字段、错误、同意与操作反馈仍保留。
- 档案年龄按8–9、10–11、12–13岁点选单选，取代下拉框；英语基础选项使用家长能观察到的例子，而非抽象等级。原包10–12岁定位由最新8–13岁决定覆盖，原始素材不改写。

- 按钮、卡片、标签和输入框：查看 DESIGN §7.1、§7.7，再映射到现有基础组件。
- iPad 轮次：DESIGN §7.9 的六状态显示在 Teeko 圆盘或孩子窗口；颜色配合形状/动态，状态由真实会话驱动。旧 Web 麦克风的五状态不替代此规则。
- 课中反馈：在原页上高亮、提示或标注发音；无积分榜与常驻评分卡，按最新要求允许短时烟花、贴纸和音效，按2026-10-31用户决定取消字幕/中文/重说菜单；暂停只保留继续和结束，按最新审阅暂时取消“慢一点”按钮。DESIGN §7.3–§7.5 的旧 Web/课外组件不作为 iPad 常驻元素。
- 圈选与点选：DESIGN §7.6，新版工具为“点一点 / 圈一圈”，不再沿用旧稿的 Move / Explain / Drill 工具设计；现有画布行为的迁移需单独验证。
- 查看 [组件状态效果图](references/teeko-design-kit/mockups/components-states.png)、[组件 HTML](references/teeko-design-kit/reference/components.html) 和 [参考 CSS](references/teeko-design-kit/reference/components.css)。
- iPad 课中优先查看 [状态总览](references/teeko-design-kit/ipad/overview.png) 和 [页面 HTML](references/teeko-design-kit/ipad/lesson.html)。

## 颜色与对比度

- 正文及小字使用相应文字语义 token；橙色底上的文字使用深蓝，浅色底上的橙色小字使用 orange-700。
- `contrast.json` 同时包含通过和禁止使用的组合，不能把整个文件都当作已通过清单。
- 对比度文件是原包随附计算结果，并非本次对实际页面的无障碍审计。最终页面仍需结合字号、背景和状态检查。

## 与当前代码的衔接

- 样式入口是 [app/globals.css](../../app/globals.css)，基础组件在 `components/ui/`，配置见 [components.json](../../components.json)。现有样式包含 `--paper`、`--ink`、`--green` 等变量，原包采用 `--tk-*` 命名。
- `/prototype` 使用独立的 `.tk-prototype` 作用域及 `components/prototype/tokens.css`，从原包 tokens 复制后将 `:root` 改为该作用域，避免覆盖旧课堂变量。其他页面仍沿用现有样式。
- 当前使用 Tailwind CSS 4 和 ES modules；原包 [tailwind.preset.js](references/teeko-design-kit/tailwind.preset.js) 是 CommonJS preset 示例。接入时适配本项目配置，不能直接假定原包的 `require` 用法可用。
- 原包 HTML/CSS 保留为参考文件；原型只加载作用域 tokens、原型样式和复制到 `public/prototype-assets/` 的 SVG、Nunito Black 与 OFL 许可，不下载新字体。
- 原包说明 tokens 由 `build_tokens.py` 生成。未来若需要扩展 tokens，先检查生成器，按原包机制同步产物，并记录变更；本次未执行生成器。

## 范围边界

导入样稿不改变现有运行时代码。课程来源、认证、进度、语音编排、数据和分期范围以 [SPEC](../specs/teeko-v1/spec.md) 为准；原型与目标的差距见 [实施待办](../specs/teeko-v1/tasks.md)。

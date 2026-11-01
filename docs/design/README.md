# 前端设计文档入口

## 当前设计与页面流基线

- [完整页面流](page-flow.md)：00公开分享长页、邀请码与账号子状态、新老用户、课堂恢复/结束、异步报告和设置。
- [产品与架构倾向](../product/current-product-direction.md)：区分已决定、实现倾向和待验证。
- [最新落地页说明](pages/landing.md)与[课堂说明](pages/classroom.md)：用户最新审阅优先于原始图稿。
- [独立管理后台](pages/admin.md)：教师智能体、模型配置、版本发布、专用登录和真实统计；规划admin.teeko.app。

## 当前状态

- 来源：用户提供的 `teeko_for_codex.zip`，包含 PRD v0.2 与设计包。
- 当前视觉版本：DESIGN v0.3（10–12 岁、iPad 横屏）；更新日期：2026-10-30，取代上一版视觉基线。
- 用途：页面和组件开发的设计参考基线。独立 `/prototype` 已接入设计素材，用模拟数据审阅27个有效页面状态；旧课堂迁到开发 `/legacy-classroom` 保留。
- 2026-10-30 用户补充优先：电脑和平板响应式网页，不是 iPad App；主要操作一屏内完成，报告和设置按页签/分页组织。见 [TK-R-017](../specs/teeko-v1/spec.md)。
- 2026-10-31 用户确认年龄范围为8–13岁；档案使用8–9、10–11、12–13岁点选与具象英语能力例子。原始10–12岁设计资料保留原文，以用户最新范围覆盖。
- 当前应用仍以项目根目录 [README](../../README.md) 所述功能为准。

## 阅读顺序

1. 先读[当前页面流](page-flow.md)和[产品方向](../product/current-product-direction.md)，再读 [SPEC 入口](../specs/README.md) 和当前任务需求；原始产品说明见 [PRD](../product/PRD.md)。再读 [全局设计规范与项目适配说明](design-system.md)。
2. 按任务选择 [首页](pages/landing.md)、[课程选择页](pages/lessons.md) 或 [课堂页](pages/classroom.md) 说明。老师头像与说话动画另读 [吉祥物与嘴型](mascot.md)。
3. 阅读原始 [DESIGN.md](references/teeko-design-kit/DESIGN.md) 对应章节。iPad 课堂优先查看 [新状态总览](references/teeko-design-kit/ipad/overview.png) 与 `ipad/`，旧 `mockups/study-*` 不覆盖新的课堂设计。
4. 需要具体数值时查阅原包的 [tokens.json](references/teeko-design-kit/tokens.json)、[tokens.css](references/teeko-design-kit/tokens.css) 和 [contrast.json](references/teeko-design-kit/contrast.json)。

## 适用范围与差异

用户当前任务和最近明确要求优先；产品范围与流程由 PRD/SPEC 描述，视觉细节按 DESIGN v0.3。原包提示词仍有旧 Web 构建顺序，不能覆盖 iPad 新稿。原材料未定项见 [决定清单](../specs/teeko-v1/decisions.md)。

| 原包内容 | 本项目的使用方式 |
|---|---|
| 10–12 岁儿童使用、iPad 横屏、一个账号一个孩子；v1 免费 | 是 PRD 的目标范围，不能把草稿承诺描述为已经上线。 |
| 内置课程，无上传、教材导入或相机入口 | 是新版方案；现有上传和教材书架仍在应用中。本次更新设计参考不删除这些功能，后续改造需明确范围。 |
| `/` 营销首页、`/learn` 课程选择、`/learn/[unit]/[lesson]` 课堂 | 是参考路由；新增路由和导航需要独立实现并验证。 |
| iPad 课堂只有课本、Teeko、孩子小窗；无常驻大按钮/反馈侧栏 | 默认语音驱动，角落暂停键进入菜单；保留真实会话机制，不从旧 Web 图复制大麦克风和三按钮操作区。 |
| 课中无积分榜；2026-10-31允许短鼓励奖励/烟花/音效，取消字幕、中文和重说菜单 | 当前教材为主、右侧师生矩形窗口，底部教材工具/暂停/结束，按最新审阅暂时取消“慢一点”按钮。替代原圆盘和菜单。按本次用户要求加入可操作的答题反馈与短奖励；原PRD开放项保留作来源。 |
| 全身矢量雀鸟、表情姿势、音频驱动嘴型 | 采用原包素材；动画与真实接收音频的衔接需另行实现，预览循环不代表老师正在发声。 |
| 孩子小窗与摄像头 | P0/P1使用头像，摄像头感知为P2；关摄像头或未出镜不触发暂停。不能因样图有孩子画面就申请视频权限。 |
| 家长账户、授权、声音用途与留存说明 | 原包将部分文案标为占位或待定；登录/同意为新 P0 需求，现有登录与授权不能自动等同于已满足新规格。 |
| 字体许可、正式课程列表及课程插画仍有开放决策 | 使用前核对资源和真实数据，不能把示例课程列表描述为已经上线。 |

设计规范说明外观与反馈方式；教学策略、接口契约和跨页面业务流程应有对应功能说明与测试。不能从截图推定业务规则已经确认。

## 原包归档

v0.3 设计文件按相对目录完整保存在 [references/teeko-design-kit](references/teeko-design-kit/README.md)，共 65 个文件，新增 iPad 状态图、总览、HTML 及渲染脚本。PRD 与包说明另归档在 [产品文档](../product/README.md)。

- 下载来源：`/Users/chengxia/Downloads/teeko_for_codex.zip`；下载目录原件保留。
- 当前资料包 ZIP SHA-256：`31a557628334f61c45d18646d8bf63c5ae15264e81ff1365158c30bfa5d7e28a`；全部 67 个源文件的位置及哈希见 [来源清单](../product/references/teeko-for-codex.manifest.json)。
- 本次原文件逐字节保留；未运行原包脚本，未安装或下载字体，未导入参考 CSS。
- 后续如修改原包，记录修改原因和涉及文件，不再将修改后的文件描述为原件。

## 版本记录

- v0.3：以 PRD v0.2 配套资料包为当前基线；增加 1194×834 iPad 极简课堂、六状态、字幕开关；课中取消星星和分数。
- v0.2：[旧版 52 文件快照](references/archive/teeko-design-kit-v0.2.zip)，由此前参考目录打包，SHA-256 为 `e13465c6a303bf7055d3ae5f29a12cafa96a0ee88235c51c834de23aaebc80fe`。保留全身吉祥物与旧 Web 方案历史。
- v0.1：[旧版源文件快照](references/archive/teeko-design-kit-v0.1.zip)，含此前归档的全部 25 个文件。它由项目中的旧版目录重新打包，不是原始下载 ZIP；快照 SHA-256 为 `03655c9c86ba0ab0e947db8af0055bf335c323f1f752d2b5a70999153ab32d62`。
- 旧版原始下载 ZIP 的 SHA-256 为 `6bda4627d6d495e658f49726afcbc05d158fa61f21c6aa43b30b3c1f7dc8ef07`，仅用于追溯，不是当前设计基线。

## 实现与验收

每次按需求编号处理页面或组件，复用现有实现；行为场景见 SPEC。P0 视觉以 1194×834 iPad 横屏状态图为主，检查真实课件的坐标、可读性、触达区域、横竖屏提示、权限与减少动画偏好。1440px Web 与 390px 手机图保留作参考，不作为 P0 手机开发要求。

2026-10-31新增[落地页00](pages/landing.md)：理念、上课方式、家长问题和本地课堂示意；注册/登录入口已接到01。正式 `/` 与 `/login` 已独立迁移，账号服务仍未接入。

2026-10-31最新落地页审阅覆盖上一版：爸爸陪学分享定位、低营销感、可滚动长页、AI虚构儿童肖像和邀请码入口；见[当前说明](pages/landing.md)。应用一屏规则不限制公开长页。

2026-10-31正式入口修正：产品使用真实视口和自然响应式布局，不挂载原型外框。`/prototype`审阅工具、`/preview`无框开发预览、`/legacy-classroom`旧课堂均仅开发可达，生产404；正式入口不引入原型账号/示例验证码。见[拆分计划与验证](../plans/2026-10-31-product-review-separation.md)。

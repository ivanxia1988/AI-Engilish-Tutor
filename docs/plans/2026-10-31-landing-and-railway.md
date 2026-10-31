# 落地页与Railway架构修订计划

**Goal:** 补充可审阅的Teeko品牌落地页，并按用户已选定Railway修正技术架构。

**Architecture:** 落地页作为独立原型00，内部页签切换理念、上课方式、家长问题。示意课堂只做本地交互；注册/登录进入01对应子状态。现有真实课堂根路径不变。架构改成Railway正式Node Web/API/WS服务、PostgreSQL、独立后台工作进程、S3兼容存储和Resend。

**Tech Stack:** 现有React、TypeScript、作用域CSS、Lucide、Teeko SVG；不增加依赖或业务网络请求，不部署。

## 设计

- 品牌名称按项目Teeko处理。“我们的理念 / 怎么上课 / 家长关心”三页签，首屏双栏，左侧主张和注册入口，右侧课堂示意。电脑与平板主要内容一屏可达，极窄屏允许内容区滚动，不能裁掉按钮。
- 主张“从想说的话，开始学英语。”围绕听孩子说完、换方式引导、用具体反馈看进步。无虚构成绩、见证、用户量、价格或免费承诺。
- 课堂示意可选择博物馆或海边并出现后续问题；只是产品方式预览，不申请麦克风、不播放伪造AI语音。开始学习进入验证码注册，登录入口进入密码登录。
- 架构以Railway为确定部署平台，Cloudflare仅可选域名/DNS。Node持有课堂连接，PostgreSQL负责事务/状态/租约/额度/任务；后台任务持久排队与重试，不依赖HTTP进程退出后的Promise。

## 实施步骤

1. 修改tests/prototype-flow.test.ts验证00为第一屏、01旧链接保留、落地页入口不能绕过登录。运行相关测试观察失败。
2. 新增components/prototype/marketing-landing.tsx及marketing-landing.css；更新lib/prototype-flow.ts和prototype.tsx的目录、路线、注册/登录导航及首屏边界。
3. 重写docs/plans/2026-10-31-teeko-architecture-design.md，并同步SPEC入口/实施待办/设计页与项目约定，清除现行架构中Cloudflare主方案描述；原始参考和历史计划不改写。
4. 运行prototype测试、npm run typecheck、npm run build、git diff --check；检查文档链接，浏览器检查页签/课堂示意/注册登录、1176与1024宽度、键盘及窄屏，保存截图。

## 2026-10-31 实际验证与交付

- 流程测试先观察到00缺失与落地页目标错误的2个失败，再实现并通过；全体prototype测试35/35，`npm run typecheck`、`npm run build`通过，`git diff --check`通过。构建仍为仓库现有Vinext流程，不是Railway生产迁移验证。
- Chrome本地`/prototype#00`：三页签、方向键、步骤展开、家长问题展开、博物馆/海边图片与老师追问、注册/密码登录与品牌返回均核验。1176×749和1024×767主要内容一屏可达；600×800纵向滚动，无横向溢出，示意选择可操作。截图时发现短宽屏页脚挤压，已加紧凑间距和内容最小高度防护，并复查按钮及示意均在页脚上方。
- 相关11份当前文档的本地链接、代码围栏与行尾空白检查通过；原始设计/PRD不改写。
- 截图：`/Users/chengxia/.codex/visualizations/2026/10/30/01a18bab-4c9e-7ef0-86af-11db9d5ada82/teeko-landing-20261031.png`。浏览器临时尺寸覆盖已恢复。
- Railway架构v0.2已替换旧Cloudflare主方案，并同步SPEC、决定、待办和AGENTS；仅文档与前端原型，不创建云资源、不更改DNS、不读取或迁移密钥、不部署。原有真实课堂`/`不变。

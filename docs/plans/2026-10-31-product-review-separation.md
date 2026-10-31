# 正式入口与审阅工具拆分实施计划

> 使用 writing-plans 与 test-driven-development，按用户已确认的入口分离方案在本会话实施并审阅。

**Goal:** 正式根路径呈现无审阅工具的产品落地页和账号界面；开发审阅、无外框预览、旧课堂回归独立隔离。

**Architecture:** 复用落地页视觉，邀请码校验通过注入适配器隔离原型内存状态。正式账号服务未接入时仅给出不可用反馈，不发送邮件、不创建演示账号或冒充已登录。审阅与预览仅开发环境可达，生产返回404。

**Tech Stack:** 现有 React、Next/Vinext、TypeScript、node:test、CSS；不安装依赖或复制环境文件。

## 任务 A：正式入口（独立 worktree）

- 分支 codex/teeko-product-entry，路径 /Users/chengxia/AItutor-worktrees/product-entry。
- app/page.tsx → 正式落地页；旧组件逐字迁至 components/legacy-classroom.tsx。
- app/login/page.tsx 与 components/product/* → 邮箱密码登录、邀请码注册入口、找回入口；校验后显示服务尚未开放，不产生假的成功。
- components/prototype/marketing-landing.tsx → 只接收显示值与事件，不引入 prototype-auth；原型由根代理适配。
- app/layout.tsx 品牌 metadata；tests/classroom-ui.test.tsx 仅更新旧组件导入；新增产品组件行为测试。
- 先验证失败测试，再实现；定向测试与 typecheck，提交后由根代理审阅集成。不得并发 build 或安装依赖。

## 任务 B：开发工具隔离与预览（主目录）

- 新建 components/development-only.tsx 与三个开发入口的 layout：仅 NODE_ENV=development 放行。
- app/preview/page.tsx 无审阅外框预览，app/legacy-classroom/page.tsx 保留旧课堂回归；app/prototype 保留原审阅工具。
- components/prototype/prototype.tsx 增加明确 preview 展示入口：顶部/底部工具与侧目录不挂载；初始即00，没有概览闪屏；不修改正式账号准入。
- components/prototype/prototype.css 无外框真实视口布局，不复用电脑/平板人工尺寸开关。
- tests/development-pages.test.tsx 先验证生产/测试/未知环境拒绝，开发放行；tests/node-production-smoke.test.ts 验证正式入口200及开发入口404。

## 验收与集成

1. 各自定向检查并提交；独立代码审阅后逐项集成。
2. 运行 node --import tsx --test tests/development-pages.test.tsx tests/product-*.test.ts tests/product-account-ui.test.tsx tests/prototype-*.test.ts tests/voice-picker.test.tsx、npm run typecheck、npm run build。
3. 干净 worktree 执行 npm run build:node 与显式生产HTTP冒烟，确认 /、/login 200，三种开发入口404，伪造旧身份仍不能调用受保护接口。
4. CUA检查正式落地页、登录和开发无框课堂：电脑与平板适配，产品页没有外框/屏号/情景控件；截图交付。
5. 同步 README、页面流、产品方向和设计入口；保留原 PRD。记录实际已完成与未接入能力，未 push/部署。

## 实际结果（2026-10-31）

- 产品入口来源提交078c2d2，主目录集成35fce21；开发隔离、适配与旧课堂回跳修复4956000。两个worktree逐项集成，未push/部署。
- 新增开发边界/路由/测试文件定向ESLint通过。现有prototype.tsx与live-connection-probe.tsx合计8个error、4个warning；对比f6fe0d8逐项rule/severity/message计数完全一致，无新增诊断，不宣称全仓lint通过。
- 58项定向检查通过（原型41、产品入口/账号9、开发隔离1、旧供应商/回跳7）。主目录typecheck及默认Vinext build通过；独立审阅无剩余阻塞问题。
- 干净product-entry worktree HEAD5149ee2（来源入口 + 隔离提交）：build:node、typecheck通过；TEEKO_NODE_SMOKE=1生产HTTP冒烟1/1通过。正式/与/login200；三个开发入口404，响应不输出审阅标记；匿名及伪造Sites身份的/api/teacher401。测试端口49780正常关闭并重绑，没有遗留生产进程。
- CUA实际核验1176×749、1440×900电脑，1194×834横屏和平板768×1024；正式页面无外框/目录/屏号控件、无水平溢出，首屏图片已加载；登录主操作在视口内。1194×834课堂预览6个工具/主操作底部825.5，小于834，审阅控件挂载数0。
- 正式落地页填写邀请码跳转区块并聚焦输入；输入原型示例码TEEKO-TRY后提示账号服务尚未开放，未跳转注册。登录空邮箱有错误；登录/注册/找回是独立语义链接，不出现演示验证码或假发信。
- 旧课堂原文件逐字迁移后，仅因路径迁移修正三处Sites登录return_to至/legacy-classroom，新增实际渲染链接测试覆盖设置与探针。
- 扩展运行的旧tests/classroom-ui.test.tsx在实时语音模拟阶段未结束，已停止；不计入通过，不将本批检查宣称完整旧课堂/真实语音端到端验收。该文件仅迁移了组件导入。
- 截图：/tmp/teeko-product-landing-desktop.jpg、/tmp/teeko-product-login.jpg、/tmp/teeko-product-landing-tablet.jpg、/tmp/teeko-classroom-frameless.jpg、/tmp/teeko-classroom-tablet.jpg。临时证据未提交仓库；真实账号/Resend/PG/Node WS与报告任务仍待接入。

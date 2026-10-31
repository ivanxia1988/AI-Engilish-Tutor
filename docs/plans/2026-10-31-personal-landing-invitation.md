# 陪学分享落地页与邀请码 Implementation Plan

**Goal:** 按用户确认的第二版视觉稿，将00落地页做成爸爸陪学分享长页，接通邀请码到注册的本地原型流程。

**Architecture:** 保留独立/prototype#00和原有真实课堂根路径。长页内容为个人缘起、方法笔记、使用步骤、邀请码、FAQ；导航滚动到相应内容。邀请码状态并入现有内存认证模型，注册、发送验证码和设置密码均验证邀请证明，完成注册才消费；登录和找回不需要邀请码。正式单次邀请码、并发兑换及Resend仍由Railway后端后续实现，不用前端假装访问控制。

**Tech Stack:** 现有React/TypeScript、作用域CSS、Lucide、Teeko SVG；生成局部场景和儿童形象素材，不增加依赖、遥测或业务网络调用。

## 已确认设计

- 文案采用父亲第一人称，真实范围仅为用户描述的陪学摸索与AI工具，不编造姓名、家庭经历、教学成绩或口碑。
- 首屏“陪孩子学英语时，我做了一个小工具。”；以填写邀请码为主要动作，登录为独立入口。
- 奶油白、深蓝、少量青绿和橙色；照片质感的虚构儿童只用于课堂示意，不更改实际课堂的摄像头/头像规则。
- 落地页可以滚动；不再受应用页一屏要求约束。移动/平板下自然排布，导航、表单和FAQ可键盘操作，减少动画下禁平滑滚动。
- 邀请码由用户私下发放。原型用明确标识的审阅示例码；空、无效、过期、停用、已使用有反馈。离开注册撤销证明；完成注册消费一次，登录/重置无需再填。

## Task 1: 邀请模型与测试

Files: lib/prototype-auth.ts、tests/prototype-auth.test.ts。

1. 添加先邀请后注册、不可绕过发送/设置密码、完成后单次消费、登录找回不受影响、导航撤销与过期的测试。
2. Run: `node --import tsx --test tests/prototype-auth.test.ts`，观察预期失败。
3. 以类型化邀请状态和短期证明补齐现有模型；保持账号与邀请码均内存有效。
4. 重跑同一测试至通过。

## Task 2: 生成并归档局部素材

Files: public/prototype-assets/landing/，素材说明；docs/design/pages/landing.md。

1. 使用imagegen生成虚构儿童肖像、海边教材插图、陪学笔记场景，复制最终图片到项目，不将整页生成图作为网页背景。
2. 保留原Teeko SVG为实际老师角色，注明儿童形象为AI生成演示。

## Task 3: 长页与注册入口

Files: components/prototype/marketing-landing.tsx/css、auth-form.tsx、prototype.tsx、lib/prototype-flow.ts。

1. 长页使用语义section、原生锚点/滚动容器、桌面双栏与窄屏堆叠；FAQ可折叠，课堂示意有简单地点选择。
2. 邀请表单通过认证模型验证并传递受限注册状态；01注册入口同样要求邀请码，旧登录与找回保留。
3. 审阅码提示只放外层原型工具，不在产品界面里放内部说明。

## Task 4: SPEC、架构与验证

Files: docs/specs/teeko-v1/{spec,acceptance,decisions,tasks}.md、docs/design/pages/landing.md、AGENTS.md、README.md、docs/plans/2026-10-31-teeko-architecture-design.md。

1. 更新TK-R-024/TK-AC-036，新增邀请制需求/验收；Railway PostgreSQL邀请表、证明与注册原子消费作为待实现，不声称真实访问控制已上线。
2. Run: `node --import tsx --test tests/prototype-*.test.ts`、`npm run typecheck`、`npm run build`、`git diff --check`。
3. 浏览器检查滚动、导航、FAQ、邀请码失败/成功、注册/返回/登录；1176与1024宽度和窄屏、键盘、减少动画；保存截图。
4. 不部署、不改真实凭据、不改DNS、不自动提交已有未跟踪工作。

## 实际交付与验证

- 完成独立00分享长页、3张局部生成素材、邀请码进入01注册、01直接注册的邀请前置、密码登录/找回原有路径；示例码说明仅在外层审阅工具。没有改真实课堂根路径、生产配置、DNS或密钥，没有部署。
- 先观察到“注册未要求邀请”“已验证邮箱可绕过邀请完成密码”两个失败，再补齐邀请验证；后续补上全貌/hash离开清理回归测试并先红后绿。最终全部prototype测试41/41，认证14/14；typecheck、build及git diff --check均通过。定向文档链接、代码围栏和未跟踪文件行尾空白检查通过。
- Chrome本地验证：首屏素材均加载；画笔标注/撤销；导航定位且保持#00；FAQ键盘展开；空码/错误/过期/停用提示；有效码进入邮箱注册；返回登录再注册仍要求邀请；找回免邀请码；全貌后重新进入01不保留注册证明。没有以浏览器检查声称真实邮件或生产认证通过。
- 1176×749、1024×767及390×800布局无横向溢出；窄屏落地页独立滚动、导航不被外层审阅条遮住。减少动画模拟下跳转即时、输入焦点正确，临时媒体与视口覆盖均已恢复。
- 按requesting-code-review独立审阅发现全貌/hash离开未清证明，已统一leavePrototypeAuth修正；复查无剩余阻塞项。也修正scrollIntoView导致外层审阅区域一起滚动的问题。
- 生成素材及最终提示词保存在public/prototype-assets/landing/README.md；页面不是整页截图背景。
- 实际页面截图：/Users/chengxia/.codex/visualizations/2026/10/30/01a18bab-4c9e-7ef0-86af-11db9d5ada82/teeko-personal-landing-hero.png、teeko-personal-landing-invitation.png。预览保留在/prototype#00。
- 正式邀请码生成、停用、原子兑换与真实Resend账号接入仍是Railway G0/G1任务；内存状态刷新重置，不是正式访问控制。

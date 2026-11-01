# 教师智能体与管理后台实施计划

**Goal:** 让运营者创建多个模型配置和教师智能体，预览组合提示词、试教、发布/回退线上版本，并查看真实注册与课堂使用。

**Architecture:** Railway Node/PG延续现有同源账号与课堂。模型配置仅保存服务/用途/模型名，不接收密钥或任意URL；智能体保存主提示词、分水平策略、声音及同供应商路线。发布解析并冻结模型参数为不可变release；新课堂再次冻结release，已有课堂不热切换。语义判断在事务外执行，结果回写前重验任务、话轮和租约，模型不直接控制计费/结束。

**Tech Stack:** Next/React、TypeScript/Zod、PostgreSQL、既有GPT Live/通义WS、OpenAI Responses及通义兼容Chat结构化教学判断。

用户已明确选择有目标的陪伴式教学，并授权想清楚后直接开发。本轮不再停留在方案或追加设计许可；管理员账号问题并行询问，不阻塞独立实现。

## 组合与生效规则

1. 固定基础规则（尊重拒绝、语音/视觉证据边界、应用拥有进度/结束）优先。
2. 智能体主提示词定义理念与行为；结构化policy按英语水平生成具体讲解、追问、提示、发散和纠错指令。
3. 用户既有语言/风格/声音/服务选择在智能体支持范围内生效；年龄不当水平，unsure先用温和低门槛活动观察。
4. 本课任务与本轮反应作为不可信参考数据注入，合理同义表达/自选物品可满足表达目标；识别不清不降级，跨多次证据才调节当前活动支持程度。
5. 一个全局active release，允许发布另一个agent或激活历史release。模型/草稿改动不追溯影响release或已有课堂。

## 并行文件所有权

- 根分支：`lib/teacher-agent.ts`契约与默认配置、admin HTTP/runtime/guard/CLI、正式入口、SPEC/设计/运行文档与最终集成。
- admin-store worktree：`db/migrations/0003_teacher_agents.sql`、`lib/server/admin-service.ts`，种子、CRUD、发布/回退、账号权限和汇总；隔离PG测试。
- admin-ui worktree：`components/admin/*`、`app/admin/*`页面（layout守卫由根分支集成）、UI测试；不加原型外框。
- teacher-runtime worktree：组合提示词、语义教学判断与纯策略、课堂冻结/服务/WS接入及相应测试。模型网络调用有界、同供应商、不持锁等待网络。

## 实施步骤与检查

1. 契约先红测：`node --import tsx --test tests/teacher-agent-contract.test.ts`，证明禁止密钥/任意URL、参数有界，再实现默认教师与五个用途配置。
2. PG先失败测试，再实现管理员权限、模型/智能体修订、原子发布/回退和不可变冻结；复用loopback测试库独立schema，不清空验收账号。
3. HTTP先验证匿名401/普通用户403、Origin、输入大小/字段、revision冲突、权限撤销；CLI授予/撤销明确账号，不自动提权首个注册者。
4. UI按概览、智能体、模型、用户与使用、教材预留组织；覆盖真实加载/空/失败/保存/发布/回退，编辑与只读最终提示预览分开。试教明确是合成文字场景，不能冒充真人课堂验收。
5. 提示与教学判断覆盖三水平、同义答案、题外话、拒绝、噪声/不清楚、提示上限；freeze后改草稿/模型不改变原课堂；迟到/撤销/换题结果不能写新任务。
6. 相应快速测试后，`npm run typecheck`、`npm test`、隔离PG集成、`npm run build:node`；独立审阅和桌面/平板浏览器检查。
7. 仅本地迁移/重启8080，保留账号、邀请码和私有配置，不push/部署云端。教材只规划入口，不实现上传/解析。

## 管理指标口径

注册=成功账号，建档=profile记录；活跃为指定日期内真实课堂用量，重连不新算课堂；时长用PG已结算用量，不冒充供应商账单。统计时区Asia/Shanghai，按7/30天筛选并标明口径；平台尚未记录的历史失败事件/教学判断不补造。默认不展示儿童原始音视频。

## 官方接口核对

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)：Responses使用text.format JSON schema。
- [通义结构化输出](https://help.aliyun.com/en/model-studio/qwen-structured-output)：Chat的json_object需提示包含JSON，应用仍校验结构；qwen-plus按非思考模式配置。
- [通义兼容Chat](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)：固定官方地域/工作空间域名，旧域仍支持，不允许后台填任意请求地址。

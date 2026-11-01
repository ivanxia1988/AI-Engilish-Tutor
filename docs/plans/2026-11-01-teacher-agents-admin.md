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

## 实施结果与校正

- 已按独立用户名/密码管理站实现，覆盖早期计划中“使用学生登录再授予管理角色”的入口想法。0003/0004迁移已应用本地验收库；创建指定admin运营身份，只存独立密码哈希，不写入源码或文档。主站8080、后台8082；规划admin.teeko.app尚未绑定。
- 三个独立worktree完成存储、界面和教学运行时，经只读审阅逐提交集成。根分支完成HTTP、SSR、运维CLI、Host/Origin和正式入口；不复制私密环境到worktree。
- 修正实际Node联调发现的内部request.url与外部Host差异；保留Host、Origin和管理会话校验。畸形后台request-target回400，测试确认后续健康请求仍可用。
- 实测发现通义JSON模式需收到完整schema；保留严格本地校验。开放表达去除旧固定答案列表；短句个人兴趣不推断成带物品，发散配置/实际轮数进入判断模型。实时老师收到的开放题也不再附穷尽答案。
- 已验证42项隔离PG测试：发布不可变、revision竞争、旧课堂冻结、语义网络不持锁、迟到/新话轮/撤权、独立管理会话、真实统计排除内部运营身份；测试schema清理。
- 实际编译后的Node烟测通过：匿名SSR/API、学生cookie拒绝、专用登录、真实配置/统计、创建/保存/预览/发布/回退、管理退出后学生会话仍有效。fixture仅loopback测试schema，不改真实学生或线上数据。
- 两家真实文字样例回归：自选三明治=correct，短句喜欢恐龙=conversation，认物苹果=correct；合成文字不是儿童麦克风/家庭整课验收。回归脚本显式开启才联网。
- 独立只读复核未发现剩余权限/评分阻断；浏览器真实页面与自动测试分别记录。教材上传/解析、完整报告、云端部署与正式子域名仍未实施。

### 最终本地验证

- `npm test`：513项，491通过、22项显式集成/联网检查默认跳过，无失败。隔离PG42项及实际Node管理员冒烟另行显式运行通过，不能把默认跳过写成通过。
- `npm run typecheck`、`npm run build:node`和本批定向ESLint通过；文档本地链接与`git diff --check`通过。
- 实际Chromium界面：指定管理员登录→主提示词→完整预览→通义自选答案试教→GPT题外兴趣试教→退出；两个实际API均200、判断与场景一致，页面无JS错误。1440×900、1194×834、1024×768无整体溢出，策略内容内部滚动；截图仅本机`/tmp/teeko-admin-live-*-policy.png`，未提交生成物。
- 主站8080根路径200，主站`/admin`跳独立后台，后台8082根路径进`/admin`，匿名管理API401；真实账号/邀请码/课堂保留。正式域名、云端发布和儿童整课教学效果尚未验收。

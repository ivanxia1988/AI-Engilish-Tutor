# 真实账号与私发邀请码后端实施计划

> 使用 writing-plans、test-driven-development 与 requesting-code-review。用户已授权正式后端开发及前述邀请方案，沿已授权worktree分工执行。

**Goal:** 从正式落地页到真实邀请、邮箱验证、设密码、会话、找回和一个孩子档案的PostgreSQL闭环。

**Architecture:** PostgreSQL单事务控制邀请兑换与账号激活；HTTP层只做输入、同源/大小限制及HttpOnly Cookie；独立Resend适配。内置Node scrypt实现成熟密码派生，随机不透明会话持久化并可撤销。此前Better Auth为候选，本批为将邮箱证明、邀请与账号创建放入同一事务采用专用应用服务，不开放另一个匿名注册入口；不自制密码算法/JWT。正式课堂、租约、额度、Node WS和异步报告仍后续接入，不因有账号就开放旧接口。

**Tech Stack:** Node生产入口、pg固定版本、PostgreSQL、React、Zod、Node crypto、Resend HTTPS API。测试使用本机Docker临时PostgreSQL，不复制线上凭据。

## 固定接口（根代理HTTP层负责）

统一 /api/v1 下，成功 {ok:true,...}；失败 {ok:false,error:{code,message}}。

| 方法路径 | 输入 | 成功输出/行为 |
|---|---|---|
| POST /invitations/verify | {code} | 设置teeko_flow Cookie；{next:'/login?intent=register'}；不消耗邀请 |
| GET /auth/state | 无 | {user:{id,email,profileComplete}或null,flow:{purpose:'register'或'reset',stage:'email'或'code'或'password',email?}或null} |
| POST /auth/code | {purpose:'register'或'reset',email} | {stage:'code',retryAfter:60}，Resend发送成功后才返回；不返回验证码 |
| POST /auth/verify | {purpose,code} | {stage:'password'}，邮箱/用途绑定证明，未创建账号或会话 |
| POST /auth/register | {password,confirmation,agreed:true} | 设置teeko_session，清flow；{next:'/onboarding'} |
| POST /auth/login | {email,password} | 设置session；{next:'/onboarding'或'/courses'} |
| POST /auth/reset | {password,confirmation} | 清flow/session；{next:'/login'}；旧密码/全部旧会话失效 |
| POST /auth/logout | {} | 撤销session/flow，清Cookie；{next:'/'} |
| POST /auth/cancel | {} | 撤销flow/清Cookie；切用途/邮箱、离开注册可调用 |
| GET/PATCH /profile | PATCH:{name,ageRange:'8–9'或'10–11'或'12–13',level:'starter'或'sentences'或'conversation'或'unsure'} | {profile:同字段或null}，仅当前用户，无客户端accountId |
| GET /courses | 无 | 需会话和建档；{courses:[]}，首批课程未发布时用真实空状态 |

APP_ORIGIN是配置的可信Origin；所有写请求要求Origin与之完全一致、JSON、体积<=8KB。缺数据库/secret/邮件配置返回503且不回显细节或凭据。正式prod origin需https（本机loopback测试例外），Cookie HttpOnly、SameSite=Lax、Path=/，https时Secure。state/profile/courses及认证响应no-store。无任意redirect参数。

## 分工 A：auth-store worktree

仅修改db/postgres.ts、db/schema.ts、db/migrations/0001_accounts.sql、drizzle.config.ts、lib/server/account-service.ts、lib/server/auth-crypto.ts、tests/account-store*.test.ts、tests/auth-crypto.test.ts。不改package/HTTP/UI/docs。

导出 AccountService(pool, {secret,sendCode,now?})，sendCode({email,code,purpose,idempotencyKey}):Promise<void>。AccountError(code,message,status)。User{id,email,profileComplete}。
方法：verifyInvitation(code)->{flowToken}；sendCode(purpose,email,flowToken?)->{flowToken,stage:'code',retryAfter:60}；verifyCode(purpose,code,flowToken)->void；register(flowToken,password,consentVersion)->{sessionToken,user}；login(email,password)->{sessionToken,user}；reset(flowToken,password)->void；session(token?)->User|null；flow(token?)->公开flow|null；logout(token?)->void；cancelFlow(token?)->void；getProfile(id)->profile|null；saveProfile(id,data)->profile；limit(key,max,windowSeconds)->void；issueInvitations({count,expiresAt,issuedBy})->[{id,code,expiresAt}]；listInvitations()->只元数据；disableInvitation(id)->void。

- 受保护摘要保存邀请码、OTP和bearer token；随机码>=128bit；密码scrypt随机盐/固定成本/恒定时间比较，8–64字符。secret至少32字节。
- 邀请状态与证明在最终提交时复查；并发两个邮箱兑换一码只激活一个。禁止部分成功账号；校验不预占；过期/停用/已用明确反馈。
- OTP5分钟、证明10分钟、邀请flow30分钟、会话7天为首批可调整参数；用途/邮箱绑定、尝试5次、发送冷却60秒及持久限流；错误尝试不能因事务回滚重置计数。邮件调用不可持有数据库事务锁，失败不保留可用OTP，不打印验证码。
- 重置password并撤销所有会话在同事务中；登录/重置竞争要重查认证版本。不要缓存会话结果跨请求。
- 集成测试TEST_DATABASE_URL指向临时Docker库；真实PG锁竞争、回滚、重启持久、过期、限流、邮件失败、错码锁定、重置撤销与账号隔离。

## 分工 B：account-ui worktree

仅修改components/product/account-*、product-landing.tsx、product.css、app/login/page.tsx、app/onboarding/page.tsx、app/courses/page.tsx、新增正式产品组件与相关product测试。不改HTTP、DB、package、prototype、docs。

使用固定接口且不导入prototype-auth；异步加载/错误/提交锁/重试/冷却；landing验证邀请成功后跳注册；刷新读取auth/state恢复stage。邮箱verify后才显示设置密码，返回/换邮箱/用途撤销旧证明；找回不借注册证明；注册保留协议确认。不要在WebStorage保存密码、OTP、bearer token或邀请码。注册后建档，最少信息同原型；课程未发布显示空状态，不造统计/报告。AppRouter guard仍需服务端，前端state不构成身份。

## 根代理负责

1. package/lock（pg和类型包只在主目录安装）、运行配置、HTTP控制器/Resend适配、脚本/迁移及env示例、同源安全与路由守卫。
2. CLI管理脚本批量生成、列元数据、停用；明文码仅导出权限0600的私有CSV，不写stdout/仓库。运行前要求管理员环境，不开放公网发码API。
3. Docker临时PG与本地受控HTTP邮件替身联调；替身只在测试注入，不出现在生产配置；真实Resend发件域名为用户确认的teeko.app，服务端已有key但未读取其值。
4. 各分支审阅/集成、实际Next生产HTTP与UI检查；更新任务状态、剩余真实配置/上线边界。未完Railway/真实收件验收不称已上线。

## 命令及验收

- npm install --save-exact pg@8.23.1；npm install --save-dev --save-exact @types/pg@8.23.1。
- Docker postgres:17-alpine临时容器，仅127.0.0.1随机端口，无用户数据/永久卷；测试后停止清理。
- node --import tsx --test tests/auth-crypto.test.ts tests/account-store*.test.ts，TEST_DATABASE_URL启用PG集成。
- HTTP定向测试：跨Origin/无Origin/超体积拒绝；不会响应OTP/token；真实Cookie与刷新；不接受oai身份头；注销/重置旧Cookie无效。
- npm run typecheck、定向eslint、npm run build:node、默认build回归；PG并发兑换与完整注册/登录/重置/建档链路；CUA产品前端按钮与状态验收。

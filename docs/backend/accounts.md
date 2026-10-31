# 真实账号与邀请码运行说明

账号本地代码、PostgreSQL事务、Node生产HTTP、Docker和前端已接入，用户已验收实际邮件、注册和档案。尚未推送、未部署到teeko.app；新增课程/课堂的当前状态见下方更新与课堂运行说明。

2026-11-01更新：用户已完成真实邮件、注册、档案的本地验收；Railway的AUTH_SECRET已安全配置且未触发部署。课程空态现由[真实课堂切片](classrooms.md)覆盖，当前提供一节野餐试上课。注册/重置邮件已换为品牌化HTML与纯文本模板，用户下次发码即可验新模板；未额外代发邮件。

## 生产配置

| 环境变量 | 用途 |
|---|---|
| APP_ORIGIN | 正式为 https://teeko.app，写请求Origin必须完全一致；不可填带路径/尾斜杠的URL |
| DATABASE_URL | Railway私网PostgreSQL连接串，应用用服务变量引用，不在文档/聊天展示值 |
| AUTH_SECRET | 至少32字节、长期稳定、独立随机服务端密钥，只在安全环境中配置；不要复用数据库密码或APIkey |
| RESEND_API_KEY | 现有Railway已配置，未读取其值；需确认拥有对应域名发送权限 |
| RESEND_FROM | Teeko <hello@auth.teeko.app>；现有auth.teeko.app已在Resend verified且启用发送，无需改DNS |
| ACCOUNT_TERMS_VERSION | 阅读确认当前试用协议后设置2026-10-31，默认空值不会开放注册；必须与页面正文版本一致 |
| PORT | Railway分配；本地示例8080 |

AUTH_SECRET保护邀请码、验证码与会话摘要，部署时必须保持稳定。更换它会使之前签发的邀请码和验证/会话证明失效，需按明确轮换计划重新发放，而不能每次部署生成一个新值。

协议正文：lib/account-terms.ts；[可读审阅稿](../product/user-agreement-review.md)。这是供项目负责人审阅的试用说明，尚未替用户发布或启用。

## 本地真实数据库运行

将.env.example复制为被git忽略的.env.local，真实值通过环境填写；不要提交文件或把密码/令牌贴到聊天。Node生产入口用于真实PG账号开发；原npm run dev仍保留Worker/Vinext旧开发路径，不能由其构建成功外推PG传输已可用。

```sh
node --env-file=.env.local scripts/migrate-accounts.mjs
npm run build:node
node --env-file=.env.local scripts/run-node-framework.mjs start
```

.env.local的APP_ORIGIN与PORT应一致（示例http://127.0.0.1:8080与8080）。生产远程地址要求HTTPS；本机loopback允许HTTP。缺配置/数据库或未批准协议版本时服务如实失败，不转为原型账号。真实验证码只由Resend投递，不提供开发万能码或HTTP响应回传OTP。

## 管理员发码

发码是受信任的服务器/本地管理命令，没有公开HTTP发码接口。默认一次10个、30天；数量1–1000、有效期1–365天可调。

```sh
node --env-file=.env.local --import tsx scripts/manage-invitations.ts issue --count 20 --days 30 --batch first-families
node --env-file=.env.local --import tsx scripts/manage-invitations.ts list
node --env-file=.env.local --import tsx scripts/manage-invitations.ts disable <邀请记录ID>
```

issue只在stdout报告数量与文件路径，明文仅写.private下随机命名的CSV（0600、独占创建、不覆盖）；也可指定仓库外的私有路径。禁止导出到仓库源码/静态public目录，并检查符号链接解析后的路径。list只显示ID、批次、有效期、停用和兑换元数据，不返回明文码或摘要。把CSV私下分发给家庭，不放在网页、仓库或群公开文件里。

邀请码校验本身不占名额；最终注册锁定邀请行，在同一事务创建账号、记录协议同意、核销邀请/邮箱证明并创建会话。导出写入或sync失败会停用刚生成的码；若数据库也不可达，命令仅报告仍需停用的记录ID，数据库恢复后按ID处理。无法从数据库摘要恢复明文码，丢失导出时应停用并重新发码。

## 固定规则和接口

- Node scrypt N32768/r8/p3、独立随机盐；密码8–64字符。会话为256bit随机不透明令牌，数据库仅存HMAC摘要；HttpOnly、SameSite=Lax、Path=/，HTTPS设置Secure。
- OTP5分钟；邮箱证明10分钟；邀请flow30分钟；会话7天。发送冷却60秒、每邮箱5次/小时、尝试5次及持久全局限制；这些是首批实现参数，可依真实试用调整，不是教学时长或价格承诺。
- 邮件失败不会留下可用OTP；错误尝试计数不因事务回滚清零；注册/找回证明不能跨邮箱/用途混用。重置提升认证版本、撤销全部旧会话与旧找回证明。
- /api/v1下真实接口：invitations/verify；auth/state/code/verify/register/login/reset/logout/cancel；profile GET/PATCH；courses GET。
- 所有写请求限定可信Origin与JSON/8KB；敏感响应no-store，客户端accountId不被接受；公开Sites身份头不能授权新账号。
- /onboarding、/courses有服务端会话守卫；未建档不能进入courses。会话保存在PG，刷新或Node进程重启不会伪造新账号或清空档案。新账号尚未授权旧Sites课堂API或开启无限供应商计费。

## Railway发布准备

仓库Dockerfile已改正式Next Node生产build/start，部署前执行scripts/migrate-accounts.mjs，健康检查/api/health须配置、数据库迁移与协议版本都就绪。缺配置返回503，不把匿名网络探针200当应用就绪。默认旧Worker开发配置仍保留做回归。

当前Railway项目AItutor仅有aitutor应用；PostgreSQL尚未创建。官方postgres模板当前版本为18，带持久卷并由Railway生成数据库密码；若采用该模板，应在发布阶段做实际PG18迁移/收件与回滚检查。本轮核心事务使用本机PG17验证，不把版本18当已实测。

正式发布需新增PG并设置私网引用、稳定AUTH_SECRET、公开APP_ORIGIN、已有Resend发件地址和批准的协议版本，再发布代码。现有线上应用尚未切换，未改DNS、未读取密钥值、未发送真实邮件、未生成生产邀请码。Railway发布工具要求明确确认后才能accept-deploy，不能把本地测试或配置方案描述为已经上线。

## 测试证据

见[实施与验证记录](../plans/2026-10-31-real-account-backend.md)。本地邮件替身只在测试注入；生产路径始终调用Resend，没有万能验证码或绕过邮件的开关。测试数据库必须指向loopback临时库，不能用生产URL。

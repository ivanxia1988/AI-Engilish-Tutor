# 动态模型密钥与 Railway 后台部署

**Goal:** 让管理员在模型页动态配置密钥，真实教学调用读取对应配置，并将正式后台部署到现有Railway项目。

**Architecture:** 模型元数据与凭据分开存储。模型JSON、发布版本、课堂快照和GET接口都不保存或返回密钥。PG独立表用AES-256-GCM加密，使用服务端稳定AUTH_SECRET经用途隔离派生加密密钥；随机nonce、认证tag及模型ID/provider作为AAD。现有环境配置作默认值，单模型覆盖优先，密钥修改供后续请求/重连使用，不更换已打开的媒体连接。管理接口复核角色、Host、Origin和凭据revision，写入或恢复默认后只返回状态。

**Tech Stack:** Node crypto、PostgreSQL、Next/React、Zod、现有Railway/Cloudflare连接与Railway CLI。

用户本轮已要求动态密钥并发布Railway，覆盖旧“后台不接收密钥”的限制。沿用独立后台admin.teeko.app，主站teeko.app，同一个Node服务/单副本及同一个PG；不改为两套数据、不覆盖既有线上AUTH_SECRET或服务商密钥，不迁移本地测试账号到线上。

## API与所有权

- 根：`lib/model-credentials.ts`契约、`lib/server/admin-http.ts`和admin-runtime、classroom-runtime/sockets接入、部署初始化、SPEC/运行文档和集成。
- 存储worktree：`db/migrations/0005_model_credentials.sql`、`lib/server/model-credentials.ts`、`tests/model-credentials*.test.ts`。提供管理状态/写入/恢复默认、内部读取、默认环境导入。不得改共享契约或其他模块。
- UI worktree：`components/admin/model-credentials-editor.tsx`、admin-console.tsx/admin.css/admin-request.ts与UI测试；模型基本信息表单之外独立凭据编辑区，密码输入不回填，失效异步结果丢弃，替换/恢复有明确反馈。

GET `/api/v1/admin/models/:id/credentials`返回provider、source(model/environment/missing)、configured、revision、updatedAt；POST同地址写入provider、expectedRevision、apiKey，通义必带workspaceId与region；POST `/credentials/reset`恢复环境默认。输入严格限制，无任意endpoint；不把供应商返回正文传给浏览器。密钥保存不要求重新发布模型ID，已有发布/课堂只冻结模型身份，不复制密钥。

## 步骤与验证

1. 契约与存储先写失败测试，覆盖输入边界、密文篡改/跨模型/错误key、管理员撤权、并发revision、默认优先级与不回显；只用loopback隔离test schema。
2. UI用状态接口读取占位，不读密钥；分开保存模型与密钥，切换模型清空输入，保存后清空敏感字段。测试加载/保存失败/恢复默认/迟到响应。
3. 真实语义判断、试教、实时WS与OpenAI视觉按模型ID解析凭据，运行时显式传递到适配器而不进公共snapshot；不同用途可用不同密钥，不跨供应商降级。
4. 现有环境密钥通过受控运维命令导入默认模型，仅无凭据行时导入；reset保留revision墓碑，不在启动时覆盖运营配置。AUTH_SECRET必须跨部署稳定。
5. `node --import tsx --test tests/model-credentials*.test.ts`、权限/WS相关快速检查、`npm run typecheck`、`npm test`、隔离PG、`npm run build:node`及实际Node/UI检查。
6. Railway核实线上现状，创建独立PostgreSQL，配置DATABASE_URL引用、APP_ORIGIN/ADMIN_ORIGIN/发件/协议版本；绑定admin子域和DNS，保留原变量。部署当前分支，迁移前置，安全初始化管理员与默认凭据，验证HTTPS、登录、匿名拒绝与真实试教；不声称儿童整课效果已验收。

## 备选取舍

仅改Railway变量需要每次重启，不能满足动态管理；明文数据库风险不可接受。本轮采用服务端加密PG覆盖，保留环境兼容，避免引入独立密钥管理基础设施。后续独立加密主密钥/轮换可另立迁移，不临时更改现有AUTH_SECRET。

## 本地实现与验证

- 存储、界面两个独立worktree已提交并集成；根分支接入三个用途、管理HTTP和部署准备。只读审阅67项纯逻辑/UI/假WS检查通过，发现并修复管理员用户名规范化导致重复轮换的边界，新增PG回归确认旧会话保留。
- `npm test`534项：510通过、24项集成/联网检查默认跳过；定向ESLint、typecheck、Next Node生产构建通过。动态凭据PG和生产准备另行显式运行8项通过；编译后的实际Node管理员烟测通过，包含凭据写入/密文、不回显、DB-only服务可用状态和恢复默认。
- 本地0005迁移已应用，现有环境凭据导入五个默认模型，原账号/邀请码/课堂保留。实际Chromium登录、五模型状态、密码框和通义空间不回填、两家真实文字试教、页面零JS错误通过。电脑/平板合成界面三尺寸及26项UI用例通过，未把合成文字当真人教学效果。
- Railway已创建独立Postgres、配置私网引用及主/后台origin；Cloudflare仅新增admin的CNAME和域名验证TXT，原主站/邮件记录未变，证书有效。旧服务原固定在981041d；连接分支接口最初返回自动跟随成功，但实际fresh-source取了main，因此最终显式固定到已验证的69cd7c3。后续更新需显式切换提交，不依赖未核实的分支自动发布。
- 首次容器部署虽成功，但业务检查发现健康503；平台明确拒绝新设旧CaC文件（已弃用railway.json），实际迁移/健康钩子未启用。已通过服务配置显式设置start/preDeploy/healthcheck/Dockerfile，再触发部署；不把首次容器SUCCESS计作业务验收。CLI运维SSH无已注册key，未额外创建SSH凭据或暴露数据库，改由已授权的部署前置命令初始化。

## 线上业务验收

- 69cd7c3的beeef52e部署实际执行preDeploy：管理员首次创建，5个默认模型凭据导入；健康200，匿名管理API401。复用旧部署会保留旧manifest，从源代码默认分支重发则会取旧main；通过明确commit解决，未让失败的main部署替换业务版本。
- 正式HTTPS `https://admin.teeko.app/`实际Chromium：指定用户名/密码登录成功；Cookie为Secure/HttpOnly/Strict且仅admin.teeko.app；5模型状态均为已配置单模型，密码框为空。通义三明治回答=correct、OpenAI恐龙兴趣=conversation，真实接口均200，页面0个JS错误，退出正常。
- 线上注册数0，内部管理员被排除；线上新PG未搬运本地学生、邀请码或课堂。主站与后台共用正式DB，不保存试教为真实课堂或虚构统计。
- 初始化完成后移除临时ADMIN_BOOTSTRAP_PASSWORD；变量名审计确认已不存在。最终fe2fa6e1部署SUCCESS，实际preDeploy显示管理员未重新创建、导入0个模型；保护密钥与两家环境密钥保留。
- 最终重发后再次登录成功，5个模型密文跨重启均可用，两家服务标志正确，健康200/登录页200/匿名管理401。正式环境1个运行副本、0崩溃、0当前warning/critical；此前误取main的失败仅保留在部署历史。
- 本批代码线上固定69cd7c3；后续文档记录提交不触发自动切换，下一次代码发布需明确提交。当前已完成用户授权的动态凭据与Railway后台上线，真人儿童整课效果/教材上传/完整报告仍不由本次验收推断。

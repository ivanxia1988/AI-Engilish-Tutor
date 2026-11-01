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

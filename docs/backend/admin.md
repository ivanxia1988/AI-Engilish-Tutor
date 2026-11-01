# 管理后台运行说明

后台规划域名为`https://admin.teeko.app`，`ADMIN_ORIGIN`必须为完整origin且不带路径；未设置时本机回落`APP_ORIGIN`。正式前后台可以指向同一Railway服务，Host为ADMIN_ORIGIN且路径为`/`时跳到受保护的`/admin`，主站根路径保持公开介绍。DNS和Railway自定义域/TLS尚未配置，不因本地开发完成就声称已上线。

## 迁移与管理员

先使用原私有环境运行`node scripts/migrate-accounts.mjs`，包含0003教师模型/智能体/发布/课堂冻结与0004独立管理凭据/会话。迁移有事务和校验和，已发布课件和原账号不覆写。

运维创建或轮换管理员：设置安全环境变量`DATABASE_URL`、`AUTH_SECRET`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`，运行`node --import tsx scripts/provision-admin.ts`。不支持命令行明文密码，不在仓库或文档放实际值。provision更新同名内部运营身份并撤销旧管理员会话；无HTTP公开入口。原普通登录密码为随机不可知哈希，实际管理密码使用独立scrypt哈希，令牌使用独立HMAC用途。Cookie为teeko_admin_session，8小时、HttpOnly/SameSite=Strict/host-only，生产Secure；学生teeko_session不被替换或清除。

登录页`/admin/login`、管理页`/admin`；`/api/v1/admin/auth/state|login|logout`只处理专用管理会话。管理API每次验证独立token及数据库角色，统计不计内部运营账号。后台写请求需要ADMIN_ORIGIN及同站约束；需要角色的API不接受学生cookie作为替代。

本地验收：主站`http://127.0.0.1:8080`，后台`http://127.0.0.1:8082/`。两进程使用相同的本地数据库和AUTH_SECRET，均设置ADMIN_ORIGIN为后台origin；后台额外设置PORT=8082。Next自定义服务器的request.url可能是内部监听地址，因此后台校验实际Host与配置的origin主机，写入再精确校验Origin；不信任任意转发头。畸形请求返回400，不退出HTTP/WS进程。

## 模型与版本

`lib/teacher-agent.ts`统一有界、严格配置契约。模型只允许服务、用途和模型ID，不接受endpoint、API key或任意字段。五份默认配置复用现有服务端密钥；教学判断为同供应商OpenAI Responses或通义兼容Chat，不能后台选通义而暗中调用OpenAI。默认模型ID只是配置，服务/权限是否实际可用需试教或真实会话验证。

`AdminService`保存模型和智能体草稿revision；发布时原子解析正确服务/用途的启用绑定，冻结完整model/policy/prompt为不可变release，单一active指针；回退切换到历史release。课堂创建在同事务冻结release到teacher_config，公共snapshot不返回私有提示/模型配置。旧课堂null配置保留兼容。teaching_state只调整当前课堂支持程度，不永久覆盖孩子档案。

语义判断先持久化完整输入，在事务外请求模型，返回后重新校验任务/话轮/epoch/租约/授权/有效期。同话轮幂等，迟到结果不能推进新题，低置信度不记答对。请求和响应、超时、并发有界，供应商失败不关语音；保守规则只作为安全兜底，不虚构掌握或评分。图片/人脸不用于成绩。

认物题保留特定对象约束；开放表达不把旧课件示例词表当作穷尽答案。单纯谈个人兴趣不推断成完成当前任务；发散策略和已交流轮数进入判断模型，未到提醒时先接续兴趣，不在建议回应里立刻拉回。通义JSON模式同时收到完整输出schema，服务端仍严格验证，不因供应商返回200就接受不合法结果。

## API

- GET `/admin/config`、`/admin/overview?days=7|30`、`/admin/users?page=0&pageSize=20`。
- POST `/admin/models`、`/admin/agents`创建，PATCH对应`:id`需expectedRevision。
- POST `/admin/agents/:id/publish`、`/admin/releases/:id/activate`发布/回退。
- POST `/admin/preview`离线组装提示，POST `/admin/tryout`实际合成文字试教。试教限流保留429，不伪装成服务故障。

以上路径前缀均为`/api/v1`。内部管理员授权/密码哈希、原始图像、供应商正文不进入这些响应或日志。所有正文有大小限制，Zod拒绝未知字段。

## 验收

隔离PG测试只接受loopback的test库，每个fixture独立schema并finally清理，不能在本地验收库TRUNCATE。生产Node冒烟通过TEEKO_ADMIN_NODE_SMOKE显式运行，禁用模型/邮件真实密钥，仅验证登录隔离、SSR/API守卫、统计、预览、发布/回退和退出；真实模型文字试教单独注明，不当作真人整课体验。

合成文字的真实模型回归用`TEEKO_TEACHER_LIVE_SMOKE=1 node --import tsx --test tests/teacher-assessment.live.test.ts`，凭据只由环境注入。默认npm test跳过联网检查；不要将一次样例通过描述为所有儿童表达或整课效果已验证。

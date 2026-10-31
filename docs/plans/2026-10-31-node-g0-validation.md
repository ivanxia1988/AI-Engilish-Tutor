# Node G0：生产构建与 HTTP 验证

日期：2026-10-31。分支：`codex/teeko-node-g0`。基线：`854afa3`。此切片验证正式 Next Node 构建与匿名 HTTP，不代表 Railway 部署、正式身份或实时语音迁移已经完成。

## 实现范围

- 新增 `lib/server/runtime-env.ts`：请求级 `AsyncLocalStorage` 保存 Worker bindings；绑定值优先，空值/未设置时回落服务端 `process.env`，不使用跨请求全局配置对象。
- `lib/ai.ts`、`lib/voice-server.ts` 改读该边界，当前模型默认值和协议保持不变。
- `worker/index.ts` 在请求入口注入环境，同时保留原 connector 请求上下文。
- WebSocket 外部事件不保证继承注册监听时的请求上下文。`captureRelayVoiceConfig()` 在建立桥时捕获该请求的豆包/智谱配置；Worker stream route只把该连接的配置闭包传入桥，不缓存整个环境到进程全局。
- 新增 `scripts/run-node-framework.mjs`，提供独立 `build:node`、`start:node`。前者执行当前依赖的 `next build --webpack`，后者执行 `next start --hostname 0.0.0.0 --port PORT`；缺省8080，错误端口和未知命令显式失败。
- build/start 均强制 `NODE_ENV=production`、`LITTLELEAF_HOSTING=railway`、`NEXT_TELEMETRY_DISABLED=1`、`TEEKO_NODE_RUNTIME=1`。不接受未验证的公网 Sites 身份头；不新增发信、模型调用或遥测。
- 默认 dev/build/start、Dockerfile、railway.json和锁文件未改。没有复制本地 env 文件或真实凭据，也没有安装依赖。

### 隔离两套框架的生成物

首次连续运行发现：Next在`.next/types`留下validator，Vinext覆盖同目录routes类型，导致随后typecheck出现4项TS2305。父任务授权最小配置隔离后，`next.config.ts`只在runner专用flag下设置`distDir=.next-node`与`typescript.tsconfigPath=tsconfig.node.json`，默认仍为空配置。Node专用配置继承基础并排除旧.next/Vinext产物，预先列入Next生成类型路径，不关闭类型检查；`.next-node`加入gitignore。仅清理一次本worktree旧.next缓存，未手改生成类型文件掩盖冲突。

## 可复现检查

在没有本地环境文件的独立worktree执行：

```sh
node --import tsx --test tests/runtime-env.test.ts tests/node-framework.test.ts tests/railway.test.ts tests/voice-server.test.ts
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build:node
TEEKO_NODE_SMOKE=1 node --import tsx --test tests/node-production-smoke.test.ts
npm run build
git diff --check
```

`node-production-smoke.test.ts` 默认为显式跳过；普通测试不会因为没有 `.next-node/BUILD_ID` 而启动生产服务或失败。只有 `TEEKO_NODE_SMOKE=1` 才检查已构建产物并启动本地服务。测试分配随机可用端口、清空子进程的供应商凭据配置；只请求loopback，不连接模型供应商。无论成功或失败都以测试清理钩子停止自己的进程。

## 实际结果

- 新模块与启动入口测试先观察到实现缺失失败，随后通过。异步环境测试覆盖并发请求、嵌套作用域、异步回调与connector上下文。
- 针对真实 `EventTarget` 在两个请求作用域外反序派发消息另补测试，先失败再通过；原始环境读取只能看到不同的process假值，而捕获配置仍分别保留A/B请求的模型和假凭据，不依赖进程环境掩盖丢失绑定。
- 上述定向测试21/21通过，其中7项为本切片新测试；现有voice-server测试使用本地假依赖，不是真实服务验收。
- 当前 Next 16.3.4 webpack生产构建通过；页面、prototype与API均生成。产物隔离后的连续验证结果见下；不把先前的类型冲突记为通过。
- 显式HTTP生产冒烟1/1通过，最终实测本地端口58575：

| 请求 | 结果 |
|---|---|
| GET /prototype | 200，页面包含Teeko |
| GET /api/network-check | 200，返回既有网络探针对象 |
| GET /api/status（匿名及伪造Sites身份头） | 200，signedIn均为false |
| POST /api/teacher（匿名及伪造Sites身份头） | 401，未尝试供应商调用 |
| 关闭子进程后重新绑定58575 | 成功，确认监听端口释放 |

- 默认Vinext构建和最终diff检查结果由下方最终连续验证记录补充。

## 仍未完成

- stream route仍使用 `WebSocketPair` 和Worker升级响应；上游桥仍依赖Worker `Response.webSocket`。这次只修复环境读取和配置捕获，不是Node WS迁移。
- Node入口当前主动保持未登录；Resend邮箱认证、邀请原子兑换、账号激活与会话撤销尚未接入。
- PostgreSQL、数据库迁移、租约/额度、Jobs和对象存储未实施；`db/index.ts`仍为D1旧入口，未在本切片假装迁移。
- GPT sideband、通义Node中转、实际长连接/麦克风/插话/家庭网络和停机恢复未验证。
- 未创建云资源、改DNS、推送代码或部署；新的Node命令只为后续迁移提供可独立运行和验收的基础。

## 最终连续验证

完成生成物隔离后，按以下顺序连续执行并全部通过：`build:node` → 显式Node HTTP smoke → 默认Vinext `build` → 基础 `typecheck` → 21项定向测试 → `git diff --check`。Node专用配置和基础配置均无未预期的自动改动；基础tsconfig.json未修改，无需追加exclude。

新Node输出在`.next-node`，默认Vinext类型仍在`.next`。两套生成物均不提交。最终HTTP测试端口58575已释放并成功重新绑定；没有留下测试监听进程。

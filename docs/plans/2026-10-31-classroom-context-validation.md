# 课堂候选结果上下文契约验证

日期：2026-10-31。分支：`codex/teeko-classroom-context`。

范围：G0 的独立领域契约草案，对应 [并行基础计划](2026-10-31-parallel-foundation.md) B、[架构 §8/11](2026-10-31-teeko-architecture-design.md)、TK-R-009/011/012 与 TK-AC-012/015/017。未接入旧课堂、供应商、数据库或正式路由。

## 文件与依赖

- `lib/domain/classroom-context.ts`：仅依赖仓库已有 Zod，定义状态快照和候选信封、严格校验及范围比较。
- `tests/classroom-context.test.ts`：使用现有 `node:test` / `assert` 风格。
- 本文：登记本任务文件所有权、契约及验证边界；不修改共享配置、索引或现有协议。

## 导出接口

| 类型 / 函数 | 含义 |
|---|---|
| `ClassroomTaskContext` | `logicalSessionId`、`courseVersion`、`connectionEpoch`、`stateRevision`、`pageId`、`activityId` 六字段 |
| `ClassroomStateSnapshot` | `{ status, context }`，业务状态独立于候选结果 |
| `CandidateTaskResult` | `{ context, payload: { text, objectIds } }`，文字和对象引用均为候选 |
| `ClassroomStateCapture` | 以 `ok` 判别的快照成功 / 格式拒绝 |
| `TaskResultRejectionReason` / `TaskResultValidation` | 以 `accepted` 判别的候选接受 / 明确原因拒绝 |
| `captureClassroomState(input: unknown)` | 严格校验，返回复制且冻结的快照；不追踪原对象后续变化 |
| `validateClassroomTaskResult(current: unknown, envelope: unknown)` | 先校验两个输入，再要求当前 `active` 且六字段完全相同；返回不可变候选或拒绝 |

所有对象使用 Zod `strict`，不剥离额外字段。标识符长 1–128 个 UTF-16 单元，无首尾空白或 ASCII 控制字符；`courseVersion` 应是应用分配的课程版本唯一引用（例如 `fruit:v1`，不能仅依赖不同课程重复的 `v1`）。代次与修订号是 0 至 `Number.MAX_SAFE_INTEGER` 的整数，不做类型转换。候选文字长 1–2000 个 UTF-16 单元，对象引用最多 20 个，且每个遵守同一标识符边界。`correct`、`usage`、`ended` 等额外字段在所有对象边界均拒绝。

快照和候选的每层对象、数组均由 Zod 复制后冻结，类型也为只读；不冻结调用方输入或保留其嵌套引用。

## 拒绝原因与顺序

| 原因 | 条件 |
|---|---|
| `invalid_state` | 当前业务快照格式非法 |
| `invalid_result` | 候选信封格式非法 |
| `not_active` | 状态是 created / preflight / paused / ending / ended |
| `session_mismatch` | 逻辑课堂不同 |
| `course_version_mismatch` | 课程版本引用不同 |
| `connection_epoch_mismatch` | 连接代次不同，旧代次或未来代次均拒绝 |
| `stale_revision` / `future_revision` | 结果修订号小于 / 大于当前 |
| `page_mismatch` | 页面不同 |
| `activity_mismatch` | 活动不同 |

若同时存在多种问题，按表中顺序返回首个原因。`accepted: true` 始终仅表示候选仍属于所提供的活动范围，不代表正确性、对象存在、动作已执行、已播报、已奖励、用量已结算或课堂完成。

## 调用方必须保持的约束

协调器必须在暂停、继续、换题、换页、结束时提升 `stateRevision`，在重连 / 接管时提升 `connectionEpoch`。本函数没有隐藏时钟、历史记录或调度器，无法发现版本未变化的 `active → paused → active` 历史；不能使用任务启动时的旧快照冒充结果到达时的当前状态。

结果到达时须读取最新权威状态，然后在实际提交事务中再次做版本条件校验。不可变快照仅防止共享对象被改写，不保证新鲜度或消除检查与提交间的竞争。身份 / 账号权限、对象存在性、有效租约、额度、数据库幂等、终态持久性及任务取消都属于调用方或未来持久层责任。

示例场景：任务在 revision=10 / epoch=2 发出；暂停、继续后 revision=12 的 active 课堂拒绝旧结果为 `stale_revision`；若恢复时建立 epoch=3 新连接，则先返回 `connection_epoch_mismatch`。

## 验证记录

- 测试先红：初始契约空实现下 42 项中 35 项按断言失败；补充恢复与字段完整性 3 项也先失败。
- `node --import tsx --test tests/classroom-context.test.ts`：45 项通过。覆盖同范围候选、各字段变化、过时 / 未来修订号、所有非 active 状态、格式 / 长度 / 整数 / 额外字段和嵌套快照隔离。
- `npm run typecheck`：通过。
- `./node_modules/.bin/eslint lib/domain/classroom-context.ts tests/classroom-context.test.ts`：通过。
- 本分支未运行真实服务、创建外部资源或生产部署；原型回归由逐项集成阶段执行，不把它描述为真实课堂验收。

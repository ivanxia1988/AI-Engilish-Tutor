# Teeko 产品需求入口

## 当前产品基线

- [当前产品方向与架构倾向](current-product-direction.md)：用户已确认的定位、范围、邀请码、课堂原则、Railway架构方向及仍待验证项；后续开发先读此文。
- [加入落地页后的页面流](../design/page-flow.md)：新老用户、课堂异常、结束/报告、我的与设置；区分屏号、子状态和正式路由候选。
- [分步并行开发计划](../plans/2026-10-31-parallel-foundation.md)：本地Git基线、worktree所有权、第一批任务与集成门槛。

上述为讨论后的派生更新，原始PRD留存不改；完整规格与验收仍由SPEC负责。

## 原始需求

- [PRD.md](PRD.md)：用户提供的 Teeko PRD v0.2，状态仍为草稿；原文逐字节保留，未改写其中的假设、技术判断和待定项。
- [资料包说明原文](references/teeko-for-codex.README.md)：说明 PRD 与视觉材料的职责和阅读顺序。
- [文件来源清单](references/teeko-for-codex.manifest.json)：记录 ZIP 内 67 个文件在项目中的位置及 SHA-256。
- 来源：下载目录的 `teeko_for_codex.zip`，2026-10-30 导入；ZIP SHA-256 为 `31a557628334f61c45d18646d8bf63c5ae15264e81ff1365158c30bfa5d7e28a`。
- 包内视觉规范为 DESIGN v0.3，65 个设计文件保存在 [设计参考目录](../design/references/teeko-design-kit/README.md)。

## 从需求到开发

1. 阅读 [SPEC 入口](../specs/README.md) 和 [Teeko v1 规格](../specs/teeko-v1/spec.md)，确认当前任务的需求编号与阶段。
2. 阅读该需求的 [验收场景](../specs/teeko-v1/acceptance.md) 以及 [待决定事项](../specs/teeko-v1/decisions.md)。
3. 页面实现另读 [设计入口](../design/README.md)。产品范围由 PRD / SPEC 描述，外观以 DESIGN v0.3 为依据。
4. 后续按 [实施待办](../specs/teeko-v1/tasks.md) 选择一个功能，再补充具体代码计划与测试。

本次完成规格接入，不代表原型已经满足新 PRD。当前代码实际能力仍见项目 [README](../../README.md)。需求变更时保留原始来源版本，修改派生 SPEC，并同步验收场景与待办。

## 材料边界

- PRD 中的法律、价格、API 能力、实验数据与外部产品评价是原作者记录；本次整理未重新核实，也不构成当前生产能力或合规结论。
- 原包引用的 `/workspace/flow/v3/` 29 张旧页面图、`/workspace/live-test/` 脚本未随包提供。不得据此声称本项目拥有这些文件或已完成同样测试。
- 原稿页面清单与 v1 范围表有屏号差异，派生规格明确记录在待决定事项中。
- 原包提示词和构建脚本作为参考材料保留，不自动执行，不覆盖用户要求和项目工作约定。

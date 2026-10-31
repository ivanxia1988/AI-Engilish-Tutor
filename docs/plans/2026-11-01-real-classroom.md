# 真实课程与本地完整上课 Implementation Plan

> **For Codex:** Use the existing execution and test-driven-development workflow task by task.

**Goal:** 让已注册用户从我的课程进入一节真实语音试上课，点选/画笔互动，暂停、恢复与结束后保留真实进度；改善事务邮件。

**Architecture:** 延用已批准的Railway Node + PostgreSQL。先发布一份人工检查的野餐试上课，冻结课程版本；自有账号鉴权、单账号活动课堂、连接代次与租约、服务端时限和幂等动作。浏览器只发送PCM/受限输入，经Node WS分别适配通义与GPT Live；此切片先采用两家受控主WS，和原规划GPT WebRTC媒体+sideband的延迟取舍分别记录，不能宣称未测的听感。

**Tech Stack:** Next Node custom HTTP server、PostgreSQL、ws、现有PCM AudioWorklet、Resend。

## 并行文件所有权

- 根目录：lib/classroom-contract.ts、lib/server/course-catalog.ts、classroom-service.ts、classroom-runtime.ts、classroom-http.ts、db/migrations/0002_classrooms.sql、API入口、package/lock、run-node-framework与Docker；数据/API/版本/安全测试及文档。
- codex/teeko-classroom-voice：classroom-sockets.ts、classroom-voice-client.ts、serve-node.mjs及语音测试/协议说明；通过openClassroomVoice租约注入PG权威，不直接更改账号实现。
- codex/teeko-classroom-product：正式courses/课堂/小结页面、独立样式、UI测试，遵循共享契约；不导入prototype-auth，不用模拟计量。
- codex/teeko-mail-templates：account-mail.ts、account-mail-template.ts、resend-mail.test.ts；HTML+text，不改密钥/账号流程。

## 任务与验证

1. 契约与课程：先测固定课程页/对象/目标有效，再实现一个版本化试上课，发布到PG。无学校年级、单元或假历史。
2. PG服务：先测账号隔离、单课堂并发、幂等/过期动作、保存/恢复、租约及上限，再实现事务与迁移。校验真实供应商事件，不信任浏览器correct/转写/计量；不存录音。
3. API：固定Origin、HttpOnly账号与已建档检查、受限JSON、状态冲突、课程列表/创建/动作/读取；旧Sites接口权限保持隔离。
4. 真实语音：先测受控WS、伪上游事件、鉴权/超时/关闭/背压，后接两家协议；再用本机安全env进行短时真实握手/发声验证，实测费用仅本次必要短会话。
5. 正式页面：课程介绍→用户点击才申请麦克风→真实连接→教材/双方窗口/指针画笔撤销→暂停与二次确认结束→事实小结。默认通义，可显式选GPT；未知网络指标如实未知。无字幕、慢一点、真实摄像头或审阅工具。
6. 邮件：先测用途/转义/HTML与text，再实现品牌模板并静态预览；不额外发验证码给用户。
7. 集成：定向测试→typecheck→正式Node build→临时隔离PG与真实HTTP/WS检查→电脑/平板浏览器；保留用户已验收的本地账号，迁移前备份，不清空验收库。重启8080供用户整节课验收，不push/部署。

## 边界

单课/每日限制为本地试运行保护参数，服务端执行，不当价格或产品时长承诺。详细报告后台尚未实施时明确未开放，不能伪造“正在生成”。不把语音转写当音素分数，不强制重复或把跳过计掌握。正式课程初始仅一节试上课，不把旧六主题样例伪装已发布。

# 正式课堂实时连接实现

日期：2026-11-01。关联 TK-R-004/006/007/009/011/012/013/019/023，TK-AC-004/005/007/008/011/012/015/017/019/026/035。用户已要求把正式账号后的课程接到真实课堂，本切片由独立 worktree `codex/teeko-classroom-voice` 实施。

## 通路和职责

浏览器只连接同源 `/ws/classrooms/{id}`，传100ms、PCM16LE单声道音频帧；输入通义16kHz、GPT Live 24kHz，输出均24kHz。Node持有长期供应商密钥及上游主WebSocket，浏览器不获得密钥、供应商会话ID、任意供应商事件透传或公开发码能力。

本地试上课先复用两家现有模型配置，采用受控PCM中转便于统一终止和PG租约验证；这与原候选GPT WebRTC+sideband通路不同。官方仍推荐WebRTC用于低延迟音频，不能把本切片的主WS实现描述为已验证等价弱网性能。未来可在相同业务租约上单独比较WebRTC，不在本次同时保留两套计费连接。

Node升级前校验准确Origin、单一账号Cookie和UUID路径，再由根模块 `openClassroomVoice` 验证PG账号/档案/课堂/租约。每2秒心跳，失去身份/租约、暂停、结束、硬截止、客户端失联、上下游积压或启动超时均关上游并释放租约。供应商会话ID由可选 `lease.started(id)` 持久化成功后才允许ready；失败不开放麦克风音频发送。关闭GPT先发session.close并有界等待session.closed，再释放TCP；未等到最终事件不能声称供应商最终用量已确认。

根模块负责PG状态、额度、口语证据和工具真实性。Socket适配不信任客户端correct、上下文、模型或课程参数，只允许audio/text/ping/close/mute；物理连接设帧尺寸、QPS、payload和背压边界。当前配置不启用多副本owner路由。

## 两家协议

- GPT Live：主WS地址固定，session.start后等待session.started；session.input_audio.append发送PCM，session.output_audio.delta返回PCM；动态上下文使用thinking.append，发声提示用commentary.append。client delegation到达后立即空thinking取消自动确认，服务端工具确认后回同一delegation ID，不把转写片段当最终答案。
- 通义：复用createQwenProtocol，先session.created→session.update→session.updated；配置完成才ready和发音频。context更新后等待session.updated再response.create；工具走原生function_call_output。HTTP点选/提示导致的revision变化会更新上下文并生成一条自然提示，未变化心跳不重复发声。
- 课堂工具在服务端串行接收已落库转写后调用；工具等待过程中若结束/失租约，不回传迟到确认、不重新发声。更高revision覆盖旧结果，不能重复执行旧动作。
- 不把通义儿童数据偷偷转给OpenAI。GPT委派执行根模块的已验证应用逻辑，不在本切片新增第二路隐藏推理请求。

协议核对来源：

- [GPT Live主WebSocket](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)
- [GPT Live会话与声音](https://developers.openai.com/api/docs/guides/live-conversations)
- [GPT Live客户端委派](https://developers.openai.com/api/docs/guides/live-delegation?delegation-mode=client)
- [通义连接与PCM](https://help.aliyun.com/en/model-studio/realtime)
- [通义客户端事件](https://help.aliyun.com/en/model-studio/client-events)、[服务端事件](https://help.aliyun.com/en/model-studio/server-events)
- [通义声音与适用型号](https://help.aliyun.com/en/model-studio/omni-voice-list)：Qwen3.8使用Jennifer/Aiden可分别匹配女声/男声；Ethan仅在其他Omni型号行出现，不能把LiveTranslate表当Omni支持依据。GPT使用官方标示Feminine的gleam与Masculine的meridian；最终选择由根模块lease.voice传入。

## 浏览器资源

ClassroomVoiceClient只在显式start时构造PcmVoiceAudio、申请audio且video:false；server ready之后才启动worklet上传。实际音频播放时钟驱动老师能量，不将网络包抵达当成已发声，不显示字幕。暂停/结束立即关闭本地声音及麦克风，迟到授权返回的stream也会停轨；重连创建新实例。调用方还负责课中退出确认和beforeunload。

scripts/serve-node.mjs将HTTP交给正式Next构建，应用WS交给独立适配。SIGINT/SIGTERM先关连接并释放租约，再关HTTP与Next，12秒兜底退出。它需要根目录提供classroom-runtime.ts及ws生产依赖；单独worktree不复制真实环境、不安装共享依赖。

## 已运行的检查

先添加失败测试，观察缺失实现以及voice override/同题feedback行为失败后补实现。17项新增检查通过：真实本机HTTP+WebSocket、拒绝跨Origin/缺Cookie、原生命令不可透传、ready次序、provider身份持久化失败、启动超时、撤销/截止/晚到工具、上下文/反馈去重、声音选择、麦克风拒绝/晚到权限/背压/旧事件及Node启动清理。

同时复用的通义协议与PCM音频16项检查通过，共33项；定向ESLint和npm run typecheck通过。所有供应商连接在这些检查中均为本机受控fakeupstream，未读取真实密钥、未发送儿童声音、未声称真实模型听感/弱网或供应商最终计量验收。真实短会话与生产构建由主目录集成后单独记录。

```sh
node --import tsx --test tests/classroom-node-server.test.ts tests/classroom-sockets.test.ts tests/classroom-voice-client.test.ts tests/voice-qwen.test.ts tests/voice-audio.test.ts
npm run typecheck
```

## 集成审阅后的发言证据修正

独立审阅发现：GPT转写原来仅以final:false发送，而PG只保存final:true，因此能对话却不能据此完成口语目标。官方明确GPT transcript deltas没有item ID或completed-turn事件，不能虚构.done事件或把每个delta标为完整回答。

本次以应用音频边界聚合：收到至少200ms有声PCM，随后实际收到至少1200ms连续低能量PCM，再等350ms转写收尾，才把当前任务下的片段聚合为一条应用final。PCM能量阈值0.015为首批实现参数，须用真实家庭音频校准；它不等同于供应商语义终点。单纯转写间隙、网络无包或委派事件均不产生final。更晚或无法确定归属的片段不作为可评分证据。

委派先静默确认等待，只有聚合证据成功落库后才调用根工具；contextKey在发言/委派接收时绑定，换题清除旧聚合和等待委派。Qwen继续使用官方completed ASR事件，先await其落库再处理后续native tool。显式typed输入也单独标source:typed落库后再转发，不用来声称发音质量。transcript契约带必填contextKey/source，根PG按当前课堂任务再校验。

新增5项接缝验证：片段/委派不误作final、PCM边界聚合含晚到后缀、换题丢弃、typed先落库、Qwen completed先落库。相关检查现为38项通过，仍全部使用本机受控fakeupstream；不冒充真实供应商听感验收。

## 回复生命周期与GPT上下文上限修正

主目录真实联网发现两处协议接缝后，本worktree补充失败测试并修正：

- 通义使用idle/pending/active/cancelling四状态队列。response.create发送即进入pending，等待response.created；取消请求后等待response.done才允许下一条create。两个等待窗口及配置回执均有15秒超时。普通教学cue只保留最新的待发项，权威context优先更新，工具输出保留；取消立即清浏览器播放并丢弃取消中的旧音频，避免重叠和旧问题继续播放。
- GPT每次thinking append复用contextChunks，按480 UTF8字节保守分块；commentary复用spokenUpdate。更新仅携带contextKey、版本、当前题、对象和确认反馈，不重发静态系统规则；当前题英语直接放在新的发声提示前部，避免静默上下文尚未注入时老师缺少新问题。此约束来自官方单append 500 tokens上限，而不是字符数上限。

新增5项回归覆盖延迟response.created、取消确认前禁止重建、回复确认缺失超时、UTF8分块/静态规则不重复，以及新题cue明确含实际问题。相关检查43项通过；真实供应商联网结果仍由主目录记录，不把fakeupstream冒充联网验收。

## Next HTTP与WS升级路径隔离

真实Next入口联调发现：首个HTTP请求会让Next安装自己的upgrade监听器，匹配app路由的升级会被其关闭。此前WS放在/api/v1/classrooms/{id}/stream，被现有/api/v1/[...path]捕获，异步账号鉴权尚未返回就发生socket hang up。

应用WS现独立为/ws/classrooms/{id}，HTTP API继续/api/v1，不触碰Next私有didWebSocketSetup开关或customServer配置。启动入口新增受控依赖注入以测试假上游；新增回归先访问HTTP模拟Next惰性升级监听器，再建立独立WS并等到真实ready事件。该检查模拟Next注册行为，实际Next+PG+供应商链路仍由主目录单独验收。

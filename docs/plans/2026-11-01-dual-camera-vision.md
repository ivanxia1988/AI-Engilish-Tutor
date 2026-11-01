# 双路线课堂视觉 Implementation Plan

**Goal:** 用户选择通义时以当前会话的原生图像帧观察；选择GPT Live时由OpenAI视觉模型观察后回传给语音老师。显式分享后才传图。

**Architecture:** 继续同源鉴权Node WS与PG课堂租约，provider取冻结的服务器课堂状态。浏览器本机摄像头预览独立于视觉分享。JPEG每秒最多1帧、最长边640×480、Base64最多192000字节；通义先音频后input_image_buffer.append，GPT路线由服务端Responses视觉请求（store:false）生成有界观察，追加当前GPT Live thinking，不向gpt-live-1发送图片。无PG结构变化，不持久化图片/录像/视觉描述。

**Tech Stack:** React、Canvas JPEG、既有WebSocket、OpenAI Responses API、node:test；无新依赖。

## 共享契约与所有权

- 根目录：lib/classroom-vision.ts（状态/限制/observer类型）、server/classroom-vision-session.ts、server/classroom-sockets.ts、runtime、WS集成测试、配置示例和SPEC/运行文档。新图像消息有独立长度/帧率，音频/控制消息继续原有较小边界；不把图像错误当音频故障。
- vision-ui worktree：新增摄像头抽帧器、classroom-voice-client.ts、camera/课堂UI及相应tests/css。显式“让老师看见我”/“停止分享”，仅自己预览和分享中区分；无摄像头/未连接不能分享；不按图片到达冒称模型已经看懂。
- vision-openai worktree：lib/server/classroom-vision-openai.ts及tests。固定官方端点、服务器环境密钥，配置OPENAI_VISION_MODEL（默认gpt-4.1-mini，已核对支持图像），有界JSON输出、超时/取消、安全错误；仅给选GPT路线调用。

## 工作步骤

1. 补共享契约，固定状态/字节和generation/sequence边界，提交后创建独立codex worktree，复用node_modules不复制环境文件。
2. 先测JPEG头/尺寸/长度、未分享/乱序/超频/停止等场景，再做WS路由；通义没有OpenAI调用，GPT没有图像进Live会话。视觉错误只停止视觉，不中断声音。
3. GPT每3秒至多一次观察、最多一项在途，不积压；开始/停止、换题、暂停、结束/失租约即取消，结果需同一contextKey及视觉generation且不超过有效期。观察只作参考，不改变成绩/进度，不推断理解程度或自动暂停。
4. UI先补显式分享/未授权/取消/晚回包/停止测试，再实现抽帧；只传相机原始方向，不镜像传输，暂停/结束/关闭设备立即停抽帧和分享。
5. 合并后定向→全量测试、TypeScript、Node构建、独立只读审阅；用非真人静态合成JPEG做两条真实接口最小验证，不采集用户/孩子画面，临时连接/schema清理。保留已有验收账号，重启8080，不push/部署。

## 当前官方接口依据

- 通义客户端事件：https://help.aliyun.com/en/model-studio/client-events （JPEG、官方推荐1fps、先audio append，Base64≤256KB；本应用使用更小上限）。
- GPT Live模型：https://developers.openai.com/api/docs/models/gpt-live-1 （不支持图像/视频输入）。
- OpenAI视觉：https://developers.openai.com/api/docs/guides/images-vision （Responses input_image及data URL）。
- GPT-4.1 mini：https://developers.openai.com/api/docs/models/gpt-4.1-mini （图像输入、Responses与结构化输出；此选择可配置，不将其声称最新旗舰）。

视觉分享状态表示通道启用/帧成功发送或分析结果返回，不等于已准确理解；模型不能识别人身份、由表情断定听懂/专注或用关摄像头触发暂停。已传到供应商的图片不能靠关闭开关撤回；停止后不再发送、旧观察作废，默认不存本机或本服务。


## 集成与验收记录

- root提交共享契约后，两个worktree分别完成浏览器/课堂显式分享与OpenAI视觉请求封装，逐提交合并；根目录实现鉴权WS分流与异步结果校验。未新增依赖或PG迁移，不使用公网上传端点。
- 浏览器JPEG低优先级每秒最多1帧，实际上限24000 Base64字节（服务端硬上限192000），先降JPEG质量再必要时降尺寸；socket有积压即丢帧，不扩大语音64KB保护。通义仅使用同一服务商原生帧；GPT Live仅接收有界观察文字，图像只进入同服务商Responses观察器。
- OpenAI观察默认gpt-4.1-mini、detail:low、store:false，每3秒最多1次且不并发积压，8秒超时和观察时效；16KiB响应上限、严格visible/description字段。OPENAI_VISION_MODEL可在服务端覆盖；可选视觉配置错误不阻止语音连接。
- 只读审阅发现并先红后绿修复：授权延迟导致旧帧逆序/突发、观察返回时未重新验证租约、非图像视觉控制消息豁免32KB，以及旧授权结果干扰新分享代次。结果返回再次鉴权、校验generation/context/TTL/abort；实际发送前复核最新序号与发送间隔。
- 明确关联已发送图片的invalid_request_error（param=image/image.*或input_image_buffer.append）只停止视觉；其他供应商会话错误继续原媒体保护。添加图片event_id，但不把供应商自己的event_id当图片消费确认。
- 422项全量测试：416通过、6个需显式环境的检查跳过；TypeScript、Node构建与定向ESLint（0error，5条既有Hook/img warning）通过。旧ASR顺序用例在并发整套运行时出现竞态，修正替身为真实VAD→response.created→tool顺序，并用实际等待屏障代替20ms睡眠，未放松生产工具校验。
- 组件合成视觉fixture验证1440×900、1194×834、1024×767三态starting/sharing/error无滚动或按钮遮挡；两按钮均可点，停止分享保留video，键盘/焦点和减少动画有效。高度767来自既有Chrome缩放整数换算，比目标768严格1px；未改用户缩放，临时viewport和媒体仿真均恢复。未申请真人媒体权限，不能当摄像头实机验收。
- 真实最小验证均使用Pillow合成蓝色汽车JPEG、Samantha合成成人提问和loopback隔离PG账号，不使用用户或孩子画面。初次通义320×240图首帧后出现provider_error；原因未保留，不能断定是尺寸/编码/时序。随后640×480标准JPEG在至少2秒PCM后原生追加无错；最终26秒问答追加21张640×480图，真实ASR后老师提到汽车并有32帧实际有声输出，最终active且错误为空。这个成功不证明所有低分辨率或家庭环境边界均通过。
- GPT路线实测观察模型识别汽车并注入当前Live thinking，nativeImageAppends=0、语音连接active，未输出或保存描述正文。首次短测未验证口头复述，另行检查实际提问后的语音反应，不将上下文注入等同于已经说出口。
- 所有探针finally关闭连接、drop临时schema、删除图像/合成音频/源码；未读取或输出密钥，保留用户本地账号。无push/部署；本地8080将在交付前重启。

### 最终GPT口头回应验证

在初次仅验证观察注入后，追加唯一一次完整GPT视觉问答：实际PG账号/Cookie/runtime/租约/WS，5秒PCM后分享640×480无人蓝车图；第一条真实观察成功后播放Samantha“你在我的摄像头里看到了什么”的英语合成提问，无汽车提示。28秒持续媒体，提问后完整观察20秒：279输入PCM、16成人有声输入帧、7条input transcript delta、1条实际持久成功的应用final；该final之后老师提到汽车，输出63帧实际有声，错误为空且最终active。3次OpenAI视觉观察均成功并匹配汽车，原图进入Live次数为0；暂停送新图后8秒TTL过期显示starting符合预期，没有把过期观察当成实时画面。GPT与通义两路的合成物体实际老师回应均已验证；不代表真人/复杂场景正确率。所有测试资源已清理。

# 双路线课堂视觉 Implementation Plan

**Goal:** 用户选择通义时以当前会话的原生图像帧观察；选择GPT Live时由OpenAI视觉模型观察后回传给语音老师。显式分享后才传图。

**Architecture:** 继续同源鉴权Node WS与PG课堂租约，provider取冻结的服务器课堂状态。浏览器本机摄像头预览独立于视觉分享。JPEG每秒最多1帧、最长边640×480、Base64最多192000字节；通义先音频后input_image_buffer.append，GPT路线由服务端Responses视觉请求（store:false）生成有界观察，追加当前GPT Live thinking，不向gpt-live-1发送图片。无PG结构变化，不持久化图片/录像/视觉描述。

**Tech Stack:** React、Canvas JPEG、既有WebSocket、OpenAI Responses API、node:test；无新依赖。

## 共享契约与所有权

- 根目录：lib/classroom-vision.ts（状态/限制/observer类型）、server/classroom-vision-input.ts、server/classroom-sockets.ts、runtime、WS集成测试、配置示例和SPEC/运行文档。新图像消息有独立长度/帧率，音频/控制消息继续原有较小边界；不把图像错误当音频故障。
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

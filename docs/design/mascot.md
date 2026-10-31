# Teeko 吉祥物与说话主视觉

## 当前参考

当前 DESIGN v0.3 沿用全身矢量雀鸟、姿势、嘴型和绑定结构；Teeko是唯一的老师角色。2026-10-31用户要求视频会议感觉，独立`/prototype`已改为右侧矩形老师窗口，将原SVG裁为近景，搭配室内背景；孩子窗口默认头像。原iPad圆盘仅保留为来源参考，现有`/`课堂未迁移。

- [完整设计说明](references/teeko-design-kit/DESIGN.md)：§6，及 §7.9 / §10.4 的 iPad 六状态与交接。
- [主视觉设定图](references/teeko-design-kit/mascot/teeko-mascot-sheet.png)。
- [设定图 HTML](references/teeko-design-kit/mascot/sheet.html)。
- [说话与音频嘴型演示](references/teeko-design-kit/mascot/talking-demo.html)。
- [正面绑定 SVG](references/teeko-design-kit/mascot/svg/teeko-rig-front.svg)、[循环演示 SVG](references/teeko-design-kit/mascot/svg/teeko-talking-loop.svg)、[头部图标](references/teeko-design-kit/mascot/teeko-head-icon.svg)。
- [iPad 状态总览](references/teeko-design-kit/ipad/overview.png)：姿势需与头像圆环、孩子窗口及真实课堂状态共同映射。

## 姿势与真实状态

| 视觉状态 | 原包素材 | 接入含义 |
|---|---|---|
| 倾听 | `pose-idle-listening.svg` | 等待或孩子正在说话。 |
| 说话 | `pose-talking.svg` | 老师真实发声时，配合音频驱动嘴型。 |
| 递麦 | `pose-handoff.svg` | 老师说完，轮到孩子。 |
| 思考 | `pose-thinking.svg` | 确实正在处理输入或等待反馈。 |
| 鼓励 | `pose-celebrate.svg` | 对应真实课后完成事件；不据此在 iPad 课中加入星星或庆祝浮层。 |

## 嘴型与动画参考

- 4 种嘴型：`closed / small / wide / oo`；原包提供正面、四分之三侧面、侧面和背面视图。
- 有音素或嘴型时间戳时优先使用时间戳；否则按实际接收的老师音频能量驱动开合。
- 原包建议每 80ms 采样、阈值 0.08 / 0.32、每个嘴型至少保持 80ms、音频结束后 120ms 内闭嘴。这些是接入起点，需针对实际播放链路校准。
- 能量驱动不等于精确音素同步；原包中无音素提示时的 `oo` 随机切换属于视觉近似。
- 无音频的循环素材用于明确标注的设计预览；生产课堂中应由真实会话和音频驱动说话状态。
- 支持减少动画偏好和文本状态；当前原型不提供字幕开关；切换课程、结束课堂或断线后清理音频与动画资源。

## 使用边界

使用原包 SVG 及其分组，不另绘不同角色；吉祥物专用橙色不作为 UI 强调色使用。原包中的生成脚本和演示文件作为参考保留，本次未运行，也未新增任何生产音频采样或网络调用。


2026-11-01正式课堂已使用单一原包正面rig及四嘴型，实际播放音量驱动，不再切换不同角度姿势。身体固定，持续静音后抬右翅递麦；暂停、孩子开口与断线取消。原包演示SVG仍只作归档参考。

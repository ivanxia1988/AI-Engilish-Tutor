"use client";
import { useRef, useState } from "react";
import { Check, LoaderCircle, Radio } from "lucide-react";
import { useLiveClassroom } from "@/hooks/use-live-classroom";
export function LiveConnectionProbe({ available, signedIn }: { available: boolean; signedIn: boolean }) {
  const [error, setError] = useState("");
  const reached = useRef(false);
  const probe = useLiveClassroom({ error: setError });
  if (probe.state === "connected" || probe.state === "closing") reached.current = true;
  const success = probe.state === "closed" && probe.usageSeconds > 0 && reached.current && !error;
  return <div className="connection-probe"><strong><Radio size={15} /> 语音连接测试</strong><p>不打开麦克风，不发送教材或对话。连接后自动结束，API 初始化可能产生用量。</p><button className="button secondary full" disabled={!available || !signedIn || probe.pending || probe.active} onClick={() => { reached.current = false; setError(""); probe.start("probe"); }}>{probe.pending || probe.active ? <LoaderCircle size={16} className="spin" /> : success ? <Check size={16} /> : <Radio size={16} />}{probe.pending || probe.active ? "正在验证连接与关闭…" : success ? "连接成功，可再次测试" : "测试 GPT-Live 连接"}</button>{success && <p className="probe-success" role="status">WebRTC 与数据通道已连接，会话已正常关闭。用量：{probe.usageSeconds} 秒。</p>}{error && <p className="error-notice compact" role="alert">{error}</p>}{available && !signedIn && <a href="/signin-with-chatgpt?return_to=%2F" target="_top">登录后测试连接</a>}</div>;
}

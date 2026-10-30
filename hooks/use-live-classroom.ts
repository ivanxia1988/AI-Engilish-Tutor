"use client";
import { useEffect, useRef, useState } from "react";
import { LiveClassroomClient, type LiveCallbacks } from "@/lib/live-client";
import type { LiveContext, LiveMode, LiveState, LiveToolCall } from "@/lib/live-protocol";
import type { LivePerformanceSummary } from '@/lib/live-performance';
import type { VoiceProviderId } from '@/lib/voice-provider';
export function useLiveClassroom(options: { provider?: VoiceProviderId; tool?: (call: LiveToolCall) => Promise<unknown>; error?: (message: string) => void; advance?: () => boolean; assistance?: () => void }) {
  const [state, setState] = useState<LiveState>("idle"), [muted, setMuted] = useState(false), [inputText, setInput] = useState(""), [outputText, setOutput] = useState(""), [usageSeconds, setUsage] = useState(0), [activity, setActivity] = useState("");
  const client = useRef<LiveClassroomClient | null>(null), optionsRef = useRef(options), alive = useRef(true), stateRef = useRef(state), audioLevel = useRef(0);
  const [pageSync, setPageSync] = useState<'pending' | 'confirmed'>('pending');
  const [coaching, setCoaching] = useState(true);
  const [performance, setPerformance] = useState<LivePerformanceSummary | null>(null), [strategy, setStrategy] = useState('baseline');
  optionsRef.current = options; stateRef.current = state;
  useEffect(() => {
    alive.current = true;
    const end = () => client.current?.dispose();
    const hide = () => { if (document.visibilityState === "hidden") void client.current?.stop(); };
    window.addEventListener("pagehide", end); document.addEventListener("visibilitychange", hide);
    return () => { alive.current = false; window.removeEventListener("pagehide", end); document.removeEventListener("visibilitychange", hide); client.current?.dispose(); };
  }, []);
  function start(mode: LiveMode, context?: LiveContext) {
    if (["connecting","connected","closing"].includes(stateRef.current)) return;
    setInput(""); setOutput(""); setMuted(false); setUsage(0); setActivity(""); stateRef.current = "connecting";
    audioLevel.current = 0; setPageSync('pending');
    setCoaching(true);
    setPerformance(null); setStrategy('baseline');
    let instance: LiveClassroomClient;
    const current = () => alive.current && client.current === instance;
    const callbacks: LiveCallbacks = {
      state: value => { if (current()) { stateRef.current = value; setState(value); } },
      transcript: (role, delta) => { if (!current()) return; if (role === "child") setInput(v => (v + delta).slice(-1800)); else setOutput(v => (v + delta).slice(-1800)); },
      usage: value => { if (current()) setUsage(value); },
      error: message => { if (current()) optionsRef.current.error?.(message); },
      activity: message => { if (current()) setActivity(message); },
      sync: value => { if (current()) setPageSync(value); },
      level: value => { if (current()) audioLevel.current = value; },
      coaching: value => { if (current()) setCoaching(value); },
      performance: value => { if (current()) setPerformance(value); },
      assistance: () => { if (current()) optionsRef.current.assistance?.(); },
      advance: () => current() ? optionsRef.current.advance?.() || false : false,
      tool: call => current() ? optionsRef.current.tool?.(call) ?? Promise.resolve({ error: "No classroom tool handler." }) : Promise.resolve({ error: "This classroom session has ended." }),
    };
    instance = new LiveClassroomClient(callbacks, undefined, options.provider || 'openai'); client.current = instance; void instance.start(mode, context);
  }
  return { state, active: state === "connected", pending: state === "connecting" || state === "closing", muted, inputText, outputText, usageSeconds, activity, pageSync, audioLevel, coaching, performance, strategy, start,
    getPerformanceReport: () => client.current?.performanceReport() || null,
    setStrategy: (label: string) => { setStrategy(label); client.current?.setStrategy(label); },
    markStutter: () => client.current?.markStutter(),
    stop: () => client.current?.stop(),
    update: (context: LiveContext) => client.current?.updateContext(context),
    speak: (text: string) => client.current?.speak(text),
    instruct: (text: string) => client.current?.instruct(text),
    refocus: () => client.current?.refocus(),
    toggleCoaching: () => client.current?.setCoaching(!coaching),
    learnerActivity: () => client.current?.learnerActivity(),
    sendTyped: (text: string) => client.current?.sendTyped(text) || false,
    toggleMute: () => setMuted(value => { client.current?.mute(!value); return !value; }),
    play: () => client.current?.play(),
  };
}

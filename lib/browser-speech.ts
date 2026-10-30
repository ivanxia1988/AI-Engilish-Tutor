export function speakText(text: string, rate: number, language: string, onEnd?: () => void) {
  if (!("speechSynthesis" in window)) { onEnd?.(); return false; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language; utterance.rate = rate; utterance.pitch = 1.08;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.lang === language && /samantha|aria|jenny|ting|xiaoxiao/i.test(v.name)) ?? voices.find(v => v.lang === language) ?? null;
  let ended = false;
  const end = () => { if (!ended) { ended = true; onEnd?.(); } };
  utterance.onend = end; utterance.onerror = end;
  window.speechSynthesis.speak(utterance);
  return true;
}
export function stopSpeech() { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(path, body instanceof FormData ? { method: "POST", body, signal } : { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal }); }
  catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new Error("网络连接中断，请稍后再试。当前学习进度会保留。"); }
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "操作未完成，请重试。");
  return result as T;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function readLimitedBody(request: Request, max: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "请求内容为空。");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); throw new ApiError(413, "内容太大，请减少教材页数或录音长度后重试。"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readJson(request: Request, max = 12_000_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "请提交 JSON 数据。");
  const bytes = await readLimitedBody(request, max);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, "请求格式不正确。"); }
}

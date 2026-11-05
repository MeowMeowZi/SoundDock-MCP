import { AUDIO_LIMIT } from "./limits.ts";

export class SeedAudioError extends Error {
  uncertain: boolean;
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain; }
}
// Bound the JSON/base64 response before decoding; never fetch a provider-supplied URL.
export async function generateSeedAudio(id: string, prompt: string, format: "wav" | "mp3", connection: { key: string; address: URL | string }) {
  const { key, address } = connection;
  let response: Response;
  try {
    response = await fetch(address, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(300_000),
      headers: { "Content-Type": "application/json", "X-Api-Key": key, "X-Api-Request-Id": id },
      body: JSON.stringify({ model: "seed-audio-1.0", text_prompt: prompt, audio_config: { format, sample_rate: 24000, enable_subtitle: false } }),
    });
  } catch { throw new SeedAudioError("连接中断或等待超时，结果与费用待核对；请勿直接重复生成", true); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 400) throw new SeedAudioError("火山引擎拒绝了生成请求，请调整描述，检查长度、内容及最长 120 秒的时长要求");
    if (response.status === 401 || response.status === 403) throw new SeedAudioError("SeedAudio 鉴权失败，请管理员检查 API Key 和模型权限");
    if (response.status === 429) throw new SeedAudioError("SeedAudio 额度不足或请求过于频繁，请检查额度后再试");
    throw new SeedAudioError(`SeedAudio 服务返回 ${response.status}，请核对结果后再生成`, true);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SeedAudioError("SeedAudio 响应为空，结果待核对", true);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > Math.ceil(AUDIO_LIMIT * 4 / 3) + 1024 * 1024) { await reader.cancel(); throw new Error("response too large"); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body.audio !== "string" || !body.audio.length || body.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.audio)) throw new Error("invalid audio");
    const bytes = Buffer.from(body.audio, "base64");
    if (!bytes.length || bytes.length > AUDIO_LIMIT) throw new Error("invalid size");
    if (format === "wav" && (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")) throw new Error("invalid WAV");
    if (format === "mp3" && bytes.toString("ascii", 0, 3) !== "ID3" && !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) throw new Error("invalid MP3");
    const duration = typeof body.duration === "number" && Number.isFinite(body.duration) && body.duration > 0 ? body.duration : null;
    const originalDuration = typeof body.original_duration === "number" && Number.isFinite(body.original_duration) && body.original_duration > 0 && body.original_duration <= 120 ? body.original_duration : null;
    return { bytes, duration, originalDuration };
  } catch { throw new SeedAudioError("SeedAudio 返回内容不完整或无法识别，结果与费用待核对", true); }
}

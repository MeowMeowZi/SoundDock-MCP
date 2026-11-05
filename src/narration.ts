import { AUDIO_LIMIT } from "./limits.ts";
import { inspectNarrationAudio, normalizeCompletedWav } from "./audio-format.ts";
import { storedNarrationParameters, narrationUpstreamParameters, validateNarrationResource } from "./narration-parameters.ts";

export class NarrationError extends Error {
  status: number;
  uncertain: boolean;
  constructor(message: string, status = 400, uncertain = false) { super(message); this.status = status; this.uncertain = uncertain; }
}
// The upstream documents WAV support but not the raw PCM layout. Derive PCM
// metadata from WAV containers after final SSE success and clean EOF, never
// from assumed s16le. Only streaming sentinel lengths may be completed.
function normalizeWav(bytes: Buffer, sampleRate: number) {
  const payloads: Buffer[] = [], metadataChunks: Buffer[] = []; let offset = 0, size = 0, format: Buffer | undefined;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || bytes.toString("ascii", offset, offset + 4) !== "RIFF") throw new Error("Incomplete WAV segment");
    const riffSize = bytes.readUInt32LE(offset + 4);
    const length = riffSize === 0xffffffff ? bytes.length - offset : riffSize + 8;
    if (length < 44 || offset + length > bytes.length) throw new Error("Incomplete WAV segment");
    const segment = normalizeCompletedWav(bytes.subarray(offset, offset + length), AUDIO_LIMIT), metadata = inspectNarrationAudio(segment, AUDIO_LIMIT);
    if (metadata.extension !== "wav" || metadata.sampleRate !== sampleRate) throw new Error("Unexpected WAV format");
    if (offset === 0 && length === bytes.length) return segment;
    let chunk = 12;
    while (chunk < segment.length) {
      const name = segment.toString("ascii", chunk, chunk + 4), count = segment.readUInt32LE(chunk + 4), start = chunk + 8;
      if (name === "fmt ") {
        const current = segment.subarray(start, start + 16);
        if (format && !format.equals(current)) throw new Error("Inconsistent PCM segments");
        format = current;
      }
      if (name === "data") { payloads.push(segment.subarray(start, start + count)); size += count; }
      else if (name !== "fmt ") {
        const metadata = segment.subarray(chunk, start + count + (count % 2));
        if (!metadataChunks.some(existing => existing.equals(metadata))) metadataChunks.push(metadata);
      }
      chunk = start + count + (count % 2);
    }
    offset += length;
  }
  const metadataSize = metadataChunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!format || !size || size + metadataSize + 44 + (size % 2) > AUDIO_LIMIT) throw new Error("Invalid WAV size");
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + metadataSize + size + (size % 2), 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); format.copy(header, 20); header.write("data", 36); header.writeUInt32LE(size, 40);
  return Buffer.concat([header.subarray(0, 36), ...metadataChunks, header.subarray(36), ...payloads, ...(size % 2 ? [Buffer.alloc(1)] : [])]);
}
export async function synthesizeNarration(task: { id: string; author_id: string; narration_text: string; speaker_id: string; format: "wav" | "mp3"; speech_rate: number; sample_rate: number; parameters_json?: string }, connection: { key: string; resourceId: string; address?: string }) {
  const parameters = storedNarrationParameters(task);
  try { validateNarrationResource(parameters, connection.resourceId); } catch (error) { throw new NarrationError((error as Error).message); }
  let response: Response;
  try {
    response = await fetch(connection.address ?? "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(300_000),
      headers: { "Content-Type": "application/json", "X-Api-Key": connection.key, "X-Api-Resource-Id": connection.resourceId, "X-Api-Request-Id": task.id },
      body: JSON.stringify({ user: { uid: task.author_id }, req_params: { text: task.narration_text, speaker: task.speaker_id, ...narrationUpstreamParameters(parameters) } }),
    });
  } catch { throw new NarrationError("旁白连接中断或等待超时，结果与费用待核对；不会自动重试", 503, true); }
  if (!response.ok) {
    await response.body?.cancel();
    if ([400, 401, 403, 429].includes(response.status)) throw new NarrationError(response.status === 400 ? "上游拒绝旁白请求，请检查台词长度、内容及音色权限" : response.status === 429 ? "旁白额度不足或请求频繁，请核对额度后明确重试" : "旁白鉴权或资源权限失败，请管理员检查服务配置", 503);
    throw new NarrationError("旁白服务异常，结果与费用待核对", 503, true);
  }
  const reader = response.body?.getReader();
  if (!reader || response.headers.get("Content-Type")?.split(";")[0].trim() !== "text/event-stream") { await response.body?.cancel(); throw new NarrationError("旁白响应不是有效流，结果与费用待核对", 503, true); }
  const chunks: Buffer[] = []; let audioSize = 0, transportSize = 0, buffer = "", event = "", data: string[] = [], eventSize = 0, success = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function dispatch() {
    if (!data.length) { event = ""; eventSize = 0; return; }
    const message = JSON.parse(data.join("\n")); data = []; eventSize = 0;
    if (success || ["151", "153"].includes(event)) throw new Error("Invalid stream completion");
    if (message.code === 20000000) {
      if ((event && event !== "152") || message.data != null) throw new Error("Invalid final response");
      success = true;
    } else if (message.code !== 0) throw new NarrationError("旁白服务拒绝或未完成生成，请核对台词、音色和资源权限", 503);
    else if (message.data != null) {
      if (event && event !== "352") throw new Error("Unexpected audio event");
      if (typeof message.data !== "string" || !message.data.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.data)) throw new Error("Invalid base64");
      const bytes = Buffer.from(message.data, "base64");
      if (bytes.toString("base64") !== message.data || (audioSize += bytes.length) > AUDIO_LIMIT) throw new Error("Invalid audio payload");
      chunks.push(bytes);
    }
    event = "";
  }
  function line(value: string) {
    if (value.endsWith("\r")) value = value.slice(0, -1);
    if (!value) { dispatch(); return; }
    if ((eventSize += value.length) > 4 * 1024 * 1024) throw new Error("Event too large");
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":"), field = colon < 0 ? value : value.slice(0, colon), content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = content;
    if (field === "data") data.push(content);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((transportSize += value.length) > Math.ceil(AUDIO_LIMIT * 4 / 3) + 16 * 1024 * 1024) throw new Error("Response too large");
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (buffer.length > 4 * 1024 * 1024) throw new Error("Line too large");
    }
    buffer += decoder.decode(); if (buffer) line(buffer); dispatch();
    if (!success || !audioSize) throw new Error("Missing final success/audio");
    const collected = Buffer.concat(chunks), bytes = task.format === "wav" ? normalizeWav(collected, parameters.sample_rate) : collected;
    const audio = inspectNarrationAudio(bytes, AUDIO_LIMIT);
    if (audio.extension !== task.format || audio.sampleRate !== parameters.sample_rate) throw new Error("Unexpected audio format");
    return { bytes, ...audio };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof NarrationError) throw error;
    throw new NarrationError("旁白流或音频不完整，结果与费用待核对；不能交付半段音频", 503, true);
  }
}

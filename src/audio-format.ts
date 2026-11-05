export const NARRATION_PREVIEW_LIMIT = 20 * 1024 * 1024;

// Only call after a bounded download or SSE with final success and clean EOF. Some
// providers leave streaming sentinels in otherwise complete PCM WAV files.
// Finite length mismatches are never repaired; inspection remains strict.
export function normalizeCompletedWav(bytes: Buffer, maximumBytes = NARRATION_PREVIEW_LIMIT) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return bytes;
  if (bytes.length < 44 || bytes.length > maximumBytes) throw new Error("Invalid preview size");
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize !== 0xffffffff && riffSize !== bytes.length - 8) throw new Error("Incomplete WAV");
  let output: Buffer | undefined;
  if (riffSize === 0xffffffff) { output = Buffer.from(bytes); output.writeUInt32LE(bytes.length - 8, 4); }
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Incomplete WAV chunk");
    const name = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (size === 0xffffffff) {
      if (name !== "data" || start === bytes.length) throw new Error("Invalid streaming WAV chunk");
      output ??= Buffer.from(bytes);
      output.writeUInt32LE(bytes.length - start, offset + 4);
      break; // A streaming data chunk consumes the remainder of the HTTP body.
    }
    if (start + size + (size % 2) > bytes.length) throw new Error("Incomplete WAV payload");
    offset = start + size + (size % 2);
  }
  return output ?? bytes;
}

// Inspect complete containers/frames, not just file-name extensions or magic.
export function inspectNarrationAudio(bytes: Buffer, maximumBytes = NARRATION_PREVIEW_LIMIT) {
  if (!bytes.length || bytes.length > maximumBytes) throw new Error("Invalid preview size");
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
    if (bytes.length < 44 || bytes.readUInt32LE(4) !== bytes.length - 8) throw new Error("Incomplete WAV");
    let offset = 12, block = 0, sampleRate = 0, dataSize = 0, formats = 0, dataChunks = 0;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("Incomplete WAV chunk");
      const name = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
      if (start + size > bytes.length) throw new Error("Incomplete WAV payload");
      if (name === "fmt ") {
        if (++formats !== 1 || size < 16 || bytes.readUInt16LE(start) !== 1) throw new Error("Unsupported WAV encoding");
        const channels = bytes.readUInt16LE(start + 2), bits = bytes.readUInt16LE(start + 14);
        sampleRate = bytes.readUInt32LE(start + 4); block = bytes.readUInt16LE(start + 12);
        if (![1, 2].includes(channels) || ![8, 16, 24, 32].includes(bits) || sampleRate < 8000 || sampleRate > 48000 || block !== channels * bits / 8 || bytes.readUInt32LE(start + 8) !== sampleRate * block) throw new Error("Invalid WAV format");
      }
      if (name === "data") { if (++dataChunks !== 1) throw new Error("Ambiguous WAV data"); dataSize = size; }
      offset = start + size + (size % 2);
    }
    if (offset !== bytes.length || !block || !dataSize || dataSize % block) throw new Error("Incomplete WAV");
    return { contentType: "audio/wav", extension: "wav", duration: dataSize / block / sampleRate, sampleRate };
  }
  let offset = 0, frames = 0, samples = 0, firstRate = 0;
  if (bytes.toString("ascii", 0, 3) === "ID3") {
    if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]) || bytes.subarray(6, 10).some(value => value > 127)) throw new Error("Invalid ID3");
    offset = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9] + (bytes[3] === 4 && (bytes[5] & 16) ? 10 : 0);
  }
  while (offset < bytes.length) {
    if (bytes.length - offset === 128 && bytes.toString("ascii", offset, offset + 3) === "TAG") { offset += 128; break; }
    if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) throw new Error("Invalid MP3 frame");
    const version = (bytes[offset + 1] >> 3) & 3, layer = (bytes[offset + 1] >> 1) & 3, bitrateIndex = bytes[offset + 2] >> 4, rateIndex = (bytes[offset + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) throw new Error("Unsupported MP3 frame");
    const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
    const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length = Math.floor((version === 3 ? 144000 : 72000) * bitrate / rate) + ((bytes[offset + 2] >> 1) & 1);
    if (offset + length > bytes.length || (firstRate && rate !== firstRate)) throw new Error("Incomplete MP3");
    firstRate = rate; samples += version === 3 ? 1152 : 576; frames++; offset += length;
  }
  if (!frames || offset !== bytes.length) throw new Error("Incomplete MP3");
  return { contentType: "audio/mpeg", extension: "mp3", duration: samples / firstRate, sampleRate: firstRate };
}

export function wav(rate = 24000) {
  const samples = rate / 100;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 400 / rate) * 3276), 44 + i * 2);
  return bytes;
}

// MPEG-2 Layer III, 64 kbit/s, 24 kHz; synthetic frames for container tests.
export function mp3() {
  const frame = Buffer.alloc(192);
  frame.set([0xff, 0xf3, 0x84, 0xc0]);
  return Buffer.concat([frame, frame, frame]);
}

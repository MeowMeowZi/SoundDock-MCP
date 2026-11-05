import assert from "node:assert/strict";
import test from "node:test";
import { inspectNarrationAudio, normalizeCompletedWav } from "../src/audio-format.ts";
import { wav, mp3 } from "./helpers/audio.mjs";

test("audio inspection validates complete containers, sample rates and size bounds", () => {
  for (const rate of [24000, 48000]) {
    const bytes = wav(rate);
    assert.deepEqual(inspectNarrationAudio(bytes), { contentType: "audio/wav", extension: "wav", duration: .01, sampleRate: rate });
    assert.throws(() => inspectNarrationAudio(bytes.subarray(0, bytes.length - 1)), /Incomplete/);
    assert.throws(() => inspectNarrationAudio(bytes, bytes.length - 1), /size/);
    const incorrect = Buffer.from(bytes);
    incorrect.writeUInt32LE(0, 28);
    assert.throws(() => inspectNarrationAudio(incorrect), /format/);
  }
  const frames = mp3();
  assert.deepEqual(inspectNarrationAudio(frames), { contentType: "audio/mpeg", extension: "mp3", duration: .072, sampleRate: 24000 });
  assert.throws(() => inspectNarrationAudio(frames.subarray(0, frames.length - 1)), /Incomplete/);
  assert.throws(() => inspectNarrationAudio(Buffer.from("not audio")), /MP3/);
});

test("only completed streaming WAV sentinel lengths can be repaired", () => {
  const original = wav();
  const streaming = Buffer.from(original);
  streaming.writeUInt32LE(0xffffffff, 4); streaming.writeUInt32LE(0xffffffff, 40);
  assert.deepEqual(normalizeCompletedWav(streaming), original);
  const truncated = original.subarray(0, original.length - 2);
  assert.throws(() => normalizeCompletedWav(truncated), /Incomplete/);
  assert.equal(normalizeCompletedWav(original), original);
});

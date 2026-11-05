import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readConfiguration } from "../src/config.mjs";
import { wav, mp3 as syntheticMp3 } from "./helpers/audio.mjs";
import { withTestResources, closeTestServer } from "./helpers/async-lifecycle.mjs";
import { availablePort } from "./helpers/available-port.mjs";

const entry = resolve("server.mjs");

async function directory(resources) {
  await mkdir("work", { recursive: true });
  const path = await mkdtemp(resolve("work/audio-mcp-"));
  resources.defer("isolated audio files", async () => {
    assert.equal(dirname(path), resolve("work"));
    await rm(path, { recursive: true, force: true });
  });
  return path;
}

async function connect(resources, env, cwd = resolve("."), script = entry) {
  const client = new Client({ name: "audio-mcp-offline-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [script], cwd, stderr: "pipe",
    env: { NODE_OPTIONS: `--import=${new URL("./helpers/network-guard.mjs", import.meta.url).href}`, ...env } });
  let logs = "";
  transport.stderr.on("data", chunk => logs += chunk);
  resources.defer("MCP child", () => client.close());
  await client.connect(transport);
  const responses = [];
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    responses.push(result);
    return result;
  };
  return { client, transport, call, responses, get logs() { return logs; } };
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "local mock was called within five seconds"); await delay(10); }
}

test("standalone STDIO MCP generates original local audio, validates parameters and never replays accepted jobs", { timeout: 60000 }, async () => withTestResources(async resources => {
  const root = await directory(resources), bytes = wav(24000), mp3 = syntheticMp3();
  const calls = [], held = new Map();
  const upstream = createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const mode = body.text_prompt || body.req_params?.text;
    calls.push({ path: req.url, headers: req.headers, body });
    if (mode === "hold") await new Promise(resolve => held.set(mode, resolve));
    if (["reject", "auth", "rate", "server-error"].includes(mode)) {
      res.writeHead({ reject: 400, auth: 403, rate: 429, "server-error": 500 }[mode]);
      return res.end("provider-secret-details");
    }
    if (req.url === "/seed") {
      if (["large-output", "resource-boundary"].includes(mode)) {
        const large = Buffer.alloc(mode === "resource-boundary" ? 6 * 1024 * 1024 : 8 * 1024 * 1024 + 44); bytes.copy(large, 0, 0, 44);
        large.writeUInt32LE(large.length - 8, 4); large.writeUInt16LE(2, 22);
        large.writeUInt32LE(96000, 28); large.writeUInt16LE(4, 32); large.writeUInt32LE(large.length - 44, 40);
        return res.end(JSON.stringify({ audio: large.toString("base64") }));
      }
      if (mode === "bad-audio") return res.end(JSON.stringify({ audio: Buffer.from("RIFF0000WAVE").toString("base64"), url: "https://must-not-fetch.invalid" }));
      if (mode === "url-only") return res.end(JSON.stringify({ url: "https://must-not-fetch.invalid" }));
      if (mode === "redirect") { res.writeHead(302, { Location: "/leaked-key" }); return res.end(); }
      return res.end(JSON.stringify({ audio: (body.audio_config.format === "mp3" ? mp3 : bytes).toString("base64"), duration: .01, original_duration: .02 }));
    }
    assert.equal(req.url, "/narration");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    let audio = body.req_params.audio_params.format === "mp3" ? mp3 : wav(body.req_params.audio_params.sample_rate);
    if (mode === "streaming-wav") { audio = Buffer.from(audio); audio.writeUInt32LE(0xffffffff, 4); audio.writeUInt32LE(0xffffffff, 40); }
    const event = `event: 352\ndata: ${JSON.stringify({ code: 0, data: audio.toString("base64") })}\n\n`;
    if (mode === "no-final") return res.end(event);
    return res.end(event + 'event: 152\ndata: {"code":20000000,"data":null}\n\n');
  });
  resources.defer("mock upstream", () => closeTestServer(upstream));
  const port = await availablePort();
  await new Promise(r => upstream.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${port}`;
  const config = join(root, "configuration with spaces.json");
  await writeFile(join(root, "seed.key"), "offline-seed-key\n");
  await writeFile(join(root, "narration.key"), "offline-narration-key\n");
  await writeFile(config, JSON.stringify({ dataDir: "./state", outputDir: "./saved audio",
    seedAudio: { apiKeyFile: "./seed.key" }, narration: { apiKeyFile: "./narration.key", resourceId: "seed-icl-2.0", voices: [{ id: "S_offline_voice", name: "Offline voice" }] } }));
  const env = { AUDIO_MCP_CONFIG_FILE: config, SEEDAUDIO_API_URL: `${base}/seed`, AUDIO_MCP_NARRATION_API_URL: `${base}/narration` };
  let session = await connect(resources, env, root);
  assert.deepEqual((await session.client.listTools()).tools.map(tool => tool.name), ["audio_get_capabilities", "audio_generate", "audio_get_job"]);
  const capabilities = (await session.call("audio_get_capabilities")).structuredContent;
  assert.equal(capabilities.seed_audio.configured, true);
  assert.equal(capabilities.narration.configured, true);
  assert.deepEqual(capabilities.narration.voices, [{ id: "S_offline_voice", name: "Offline voice" }]);
  assert.equal(capabilities.output_dir, resolve(root, "saved audio"));
  assert.equal(calls.length, 0, "capability discovery does not call a paid provider");

  const generate = args => session.call("audio_generate", { wait_seconds: 2, ...args });
  const sfx = { request_id: "game:confirm:v1", kind: "sfx", prompt: "button confirm", title: "../CON:button" };
  const ready = (await generate(sfx)).structuredContent.job;
  assert.equal(ready.status, "ready"); assert.equal(ready.format, "wav");
  assert.equal(dirname(ready.file.path), join(root, "saved audio", ready.job_id));
  assert.deepEqual(await readFile(ready.file.path), bytes);
  assert.equal(ready.file.byte_size, bytes.length); assert.equal(ready.file.sample_rate, 24000);
  assert.equal(ready.file.duration, .01); assert.equal(ready.file.original_duration, .02);
  assert.match(ready.file.sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["x-api-key"], "offline-seed-key");
  assert.match(calls[0].headers["x-api-request-id"], /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[0].body, { model: "seed-audio-1.0", text_prompt: sfx.prompt, audio_config: { format: "wav", sample_rate: 24000, enable_subtitle: false } });
  assert.deepEqual(Buffer.from((await session.client.readResource({ uri: ready.resource_uri })).contents[0].blob, "base64"), bytes);
  assert.equal((await generate({ ...sfx, format: "wav", wait_seconds: 0 })).structuredContent.job.job_id, ready.job_id);
  assert.equal((await generate({ ...sfx, prompt: "different" })).structuredContent.code, "REQUEST_ID_CONFLICT");
  assert.equal(calls.length, 1, "ready response loss and conflicts never replay upstream");

  const bgm = (await generate({ request_id: "music-v1", kind: "bgm", prompt: "shop music", format: "mp3", title: "same name" })).structuredContent.job;
  assert.equal(bgm.status, "ready"); assert.deepEqual(await readFile(bgm.file.path), mp3);
  const largeResult = await generate({ request_id: "large-output", kind: "sfx", prompt: "large-output" });
  assert.equal(largeResult.structuredContent.job.status, "ready");
  assert.ok(JSON.stringify(largeResult).length < 10000, "large audio never enters tool output as Base64");
  await assert.rejects(session.client.readResource({ uri: largeResult.structuredContent.job.resource_uri }), /6 MiB/);
  const boundary = (await generate({ request_id: "resource-boundary", kind: "sfx", prompt: "resource-boundary" })).structuredContent.job;
  assert.equal(boundary.status, "ready");
  const boundaryBytes = Buffer.from((await session.client.readResource({ uri: boundary.resource_uri })).contents[0].blob, "base64");
  assert.equal(boundaryBytes.length, 6 * 1024 * 1024, "resource Base64 fits the SDK default STDIO buffer at the boundary");
  const beforeInvalid = calls.length;
  const invalid = [
    { request_id: "missing-prompt", kind: "sfx" },
    { request_id: "wrong-fields", kind: "sfx", prompt: "sound", text: "not allowed" },
    { request_id: "missing-voice", kind: "narration", text: "Hello" },
    { request_id: "unknown-voice", kind: "narration", text: "Hello", voice_id: "S_guessed" },
    { request_id: "too-long", kind: "narration", text: "台".repeat(23000), voice_id: "S_offline_voice" },
    { request_id: "wrong-rate", kind: "narration", text: "Hello", voice_id: "S_offline_voice", parameters: { sample_rate: 12345 } },
    { request_id: "wrong-dependency", kind: "narration", text: "Hello", voice_id: "S_offline_voice", parameters: { context_text: "happy" } },
    { request_id: "unknown-option", kind: "narration", text: "Hello", voice_id: "S_offline_voice", parameters: { guess: 1 } },
  ];
  for (const input of invalid) assert.equal((await generate(input)).isError, true, input.request_id);
  assert.equal(calls.length, beforeInvalid, "invalid inputs fail before billing");
  assert.equal((await session.call("audio_get_job", { request_id: "missing-prompt", wait_seconds: 0 })).structuredContent.code, "NOT_FOUND");

  const narrationInput = { request_id: "voice-v1", kind: "narration", text: "streaming-wav", voice_id: "S_offline_voice",
    parameters: { sample_rate: 48000, speech_rate: 10, model: "seed-tts-2.0-expressive", context_text: "Warm, unspoken direction", pitch: 2 } };
  const narration = (await generate(narrationInput)).structuredContent.job;
  assert.equal(narration.status, "ready"); assert.deepEqual(await readFile(narration.file.path), wav(48000));
  const speechCall = calls.at(-1);
  assert.equal(speechCall.headers["x-api-key"], "offline-narration-key");
  assert.equal(speechCall.headers["x-api-resource-id"], "seed-icl-2.0");
  assert.equal(speechCall.body.req_params.text, "streaming-wav");
  assert.equal(speechCall.body.req_params.speaker, "S_offline_voice");
  assert.equal(speechCall.body.req_params.model, "seed-tts-2.0-expressive");
  assert.deepEqual(speechCall.body.req_params.audio_params, { format: "wav", sample_rate: 48000, speech_rate: 10 });
  assert.deepEqual(JSON.parse(speechCall.body.req_params.additions), { post_process: { pitch: 2 }, context_texts: ["Warm, unspoken direction"] });
  const narratedMp3 = (await generate({ request_id: "voice-mp3", kind: "narration", text: "hello", voice_id: "S_offline_voice", format: "mp3" })).structuredContent.job;
  assert.equal(narratedMp3.status, "ready"); assert.deepEqual(await readFile(narratedMp3.file.path), mp3);

  for (const [mode, status] of [["reject", "failed"], ["auth", "failed"], ["rate", "failed"], ["server-error", "uncertain"], ["bad-audio", "uncertain"], ["url-only", "uncertain"], ["redirect", "uncertain"]]) {
    const input = { request_id: `error-${mode}`, kind: "sfx", prompt: mode };
    const response = await generate(input);
    assert.equal(response.isError, true); assert.equal(response.structuredContent.job.status, status, mode);
    const count = calls.length;
    assert.equal((await generate(input)).structuredContent.job.status, status);
    assert.equal(calls.length, count, "errors do not automatically retry");
    assert.equal((await session.call("audio_get_job", { request_id: input.request_id, wait_seconds: 0 })).structuredContent.job.status, status);
  }
  const noFinal = (await generate({ request_id: "speech-no-final", kind: "narration", text: "no-final", voice_id: "S_offline_voice" })).structuredContent.job;
  assert.equal(noFinal.status, "uncertain");

  const hold = { request_id: "shared:hold", kind: "sfx", prompt: "hold", wait_seconds: 0 };
  assert.equal((await generate(hold)).structuredContent.job.status, "processing");
  await until(() => held.has("hold"));
  const second = await connect(resources, env, root);
  const countBeforeConcurrent = calls.length;
  const duplicates = await Promise.all([session.call("audio_generate", hold), second.call("audio_generate", hold)]);
  assert.ok(duplicates.every(response => response.structuredContent.job.status === "processing"));
  assert.equal((await second.call("audio_generate", { ...hold, request_id: "not-yet-accepted" })).structuredContent.code, "BUSY");
  assert.equal((await second.call("audio_get_job", { request_id: "not-yet-accepted", wait_seconds: 0 })).structuredContent.code, "NOT_FOUND");
  assert.equal(calls.length, countBeforeConcurrent, "two real processes preserve one paid call");
  held.get("hold")();
  assert.equal((await second.call("audio_get_job", { request_id: hold.request_id, wait_seconds: 2 })).structuredContent.job.status, "ready");
  assert.equal((await second.call("audio_generate", { request_id: "not-yet-accepted", kind: "sfx", prompt: "after busy", wait_seconds: 2 })).structuredContent.job.status, "ready");
  await second.client.close();

  held.delete("hold");
  const saveFailureInput = { ...hold, request_id: "save-failure" };
  const saveFailure = (await generate(saveFailureInput)).structuredContent.job;
  await until(() => held.has("hold"));
  await mkdir(join(root, "saved audio", saveFailure.job_id));
  held.get("hold")();
  assert.equal((await session.call("audio_get_job", { request_id: "save-failure", wait_seconds: 2 })).structuredContent.job.status, "uncertain");
  const afterStorageFailure = calls.length;
  assert.equal((await generate(saveFailureInput)).structuredContent.job.status, "uncertain");
  assert.equal(calls.length, afterStorageFailure, "a failed local save cannot trigger a second paid generation");

  await writeFile(ready.file.path, "externally changed");
  await assert.rejects(session.client.readResource({ uri: ready.resource_uri }), /missing or changed/);
  assert.equal((await session.call("audio_get_job", { request_id: sfx.request_id, wait_seconds: 0 })).structuredContent.job.status, "ready");
  for (const name of await readdir(join(root, "state"))) {
    const data = await readFile(join(root, "state", name));
    for (const secret of ["offline-seed-key", "offline-narration-key", "provider-secret-details"]) assert.equal(data.includes(Buffer.from(secret)), false, name);
  }
  const publicData = JSON.stringify(session.responses) + session.logs + JSON.stringify(second.responses) + second.logs;
  for (const secret of ["offline-seed-key", "offline-narration-key", "provider-secret-details"]) assert.equal(publicData.includes(secret), false);
  const beforeRestart = calls.length;
  await session.client.close();
  session = await connect(resources, env, root);
  assert.equal((await session.call("audio_get_job", { request_id: "music-v1", wait_seconds: 0 })).structuredContent.job.job_id, bgm.job_id);
  assert.equal((await session.call("audio_generate", { request_id: "music-v1", kind: "bgm", prompt: "shop music", format: "mp3", title: "same name", wait_seconds: 0 })).structuredContent.job.job_id, bgm.job_id);
  assert.equal(calls.length, beforeRestart, "a genuine server restart never replays completed work");
}));

test("a killed generation becomes uncertain after restart without a paid replay", { timeout: 30000 }, async () => withTestResources(async resources => {
  const root = await directory(resources), calls = [];
  const upstream = createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    calls.push(JSON.parse(text));
    res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"audio":"');
  });
  resources.defer("interrupted mock", () => closeTestServer(upstream));
  const port = await availablePort();
  await new Promise(r => upstream.listen(port, "127.0.0.1", r));
  const env = { AUDIO_MCP_DATA_DIR: join(root, "state"), AUDIO_MCP_OUTPUT_DIR: join(root, "files"),
    SEEDAUDIO_API_KEY: "offline-interrupted-key", SEEDAUDIO_API_URL: `http://127.0.0.1:${port}/seed` };
  const first = await connect(resources, env, root);
  const args = { request_id: "interrupted-v1", kind: "sfx", prompt: "held response", wait_seconds: 0 };
  assert.equal((await first.call("audio_generate", args)).structuredContent.job.status, "processing");
  await until(() => calls.length === 1);
  process.kill(first.transport.pid, "SIGKILL");
  await first.client.close();
  const second = await connect(resources, env, root);
  const recovered = (await second.call("audio_get_job", { request_id: args.request_id, wait_seconds: 0 })).structuredContent.job;
  assert.equal(recovered.status, "uncertain");
  assert.equal((await second.call("audio_generate", args)).structuredContent.job.status, "uncertain");
  assert.equal(calls.length, 1, "reading and resubmitting the original ID never sends the paid request again");
}));

test("configuration rejects unsafe or malformed inputs without disclosing credentials", async () => withTestResources(async resources => {
  const root = await directory(resources), file = join(root, "config.json");
  assert.equal(readConfiguration({}).seed.key, "");
  assert.throws(() => readConfiguration({ AUDIO_MCP_DATA_DIR: "relative" }), /absolute/);
  assert.throws(() => readConfiguration({ AUDIO_MCP_CONFIG_FILE: join(root, "missing.json") }), error => error.code === "CONFIG_INVALID");
  await writeFile(file, '{"secret-unknown-field":"must-not-appear"}');
  assert.throws(() => readConfiguration({ AUDIO_MCP_CONFIG_FILE: file }), error => !error.message.includes("must-not-appear"));
  await writeFile(file, JSON.stringify({ dataDir: "./state", seedAudio: { apiKeyFile: "./missing.key", apiKey: "must-not-fallback" } }));
  let config = readConfiguration({ AUDIO_MCP_CONFIG_FILE: file });
  assert.equal(config.seed.key, ""); assert.ok(config.seed.error);
  assert.equal(config.dataDir, join(root, "state"));
  config = readConfiguration({ SEEDAUDIO_API_KEY: "key", SEEDAUDIO_API_URL: "http://public.example/unsafe", NARRATION_API_KEY: "voice-key", AUDIO_MCP_NARRATION_API_URL: "https://user:password@example.test/path" });
  assert.ok(config.seed.error); assert.ok(config.narration.error);
  assert.throws(() => readConfiguration({ AUDIO_MCP_VOICES_JSON: '[{"id":"same","name":"one"},{"id":"same","name":"two"}]' }), /unique/);
  const session = await connect(resources, { AUDIO_MCP_DATA_DIR: join(root, "empty-state"), AUDIO_MCP_OUTPUT_DIR: join(root, "empty-output") }, root);
  const capability = (await session.call("audio_get_capabilities")).structuredContent;
  assert.equal(capability.seed_audio.configured, false); assert.equal(capability.narration.configured, false);
  assert.deepEqual(capability.seed_audio.missing, ["api_key"]);
  assert.deepEqual(capability.narration.missing, ["api_key", "resource_id", "voices"]);
  assert.equal((await session.call("audio_generate", { request_id: "not-configured", kind: "sfx", prompt: "sound", wait_seconds: 0 })).structuredContent.code, "NOT_CONFIGURED");
  assert.equal((await session.call("audio_get_job", { request_id: "not-configured", wait_seconds: 0 })).structuredContent.code, "NOT_FOUND");
}));

test("a copied standalone package runs without board source or a build", async () => withTestResources(async resources => {
  const root = await directory(resources), portable = join(root, "standalone copy");
  await mkdir(portable);
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  for (const file of ["package.json", "package-lock.json", ...manifest.files]) await cp(file, join(portable, file), { recursive: true });
  assert.equal(manifest.dependencies["@modelcontextprotocol/sdk"], "1.30.0");
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) assert.ok(chunk.length);
    res.end(JSON.stringify({ audio: wav(24000).toString("base64") }));
  });
  resources.defer("portable mock", () => closeTestServer(upstream));
  const port = await availablePort();
  await new Promise(r => upstream.listen(port, "127.0.0.1", r));
  const session = await connect(resources, { AUDIO_MCP_DATA_DIR: join(root, "state"), AUDIO_MCP_OUTPUT_DIR: join(root, "files"),
    SEEDAUDIO_API_KEY: "offline-portable-key", SEEDAUDIO_API_URL: `http://127.0.0.1:${port}/seed` }, portable, join(portable, "server.mjs"));
  const job = (await session.call("audio_generate", { request_id: "portable-v1", kind: "sfx", title: "CONIN$", prompt: "portable test", wait_seconds: 2 })).structuredContent.job;
  assert.equal(job.status, "ready");
  assert.deepEqual(await readFile(job.file.path), wav(24000));
  assert.ok(job.file.path.endsWith("_CONIN$.wav"), "Windows console device names cannot become output devices");
  const unicode = (await session.call("audio_generate", { request_id: "unicode-title-v1", kind: "sfx", title: "\u732b".repeat(120), prompt: "portable test", wait_seconds: 2 })).structuredContent.job;
  assert.equal(unicode.status, "ready");
  assert.deepEqual(await readFile(unicode.file.path), wav(24000));
  assert.ok(Buffer.byteLength(basename(unicode.file.path), "utf8") <= 204, "long Unicode titles fit the filesystem byte limit");
  assert.equal((await readdir(portable)).includes("app"), false);
  assert.equal((await readdir(portable)).includes("lib"), false);
}));

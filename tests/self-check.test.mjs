import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { withTestResources } from "./helpers/async-lifecycle.mjs";

async function runCheck(config) {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
    if (process.env[key]) env[key] = process.env[key];
  env.AUDIO_MCP_CONFIG_FILE = config;
  env.NODE_OPTIONS = `--import=${new URL("./helpers/network-guard.mjs", import.meta.url).href}`;
  const child = spawn(process.execPath, ["scripts/check.mjs"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  return { code, stdout, stderr };
}

test("the installation self-check uses STDIO and needs no provider or payment", { timeout: 15000 }, async () => withTestResources(async resources => {
  await mkdir("work", { recursive: true });
  const root = await mkdtemp(resolve("work/check-"));
  resources.defer("check files", async () => {
    assert.equal(dirname(root), resolve("work"));
    await rm(root, { recursive: true, force: true });
  });
  const config = join(root, "local config.json");
  await writeFile(config, JSON.stringify({ dataDir: "./state", outputDir: "./audio" }));
  const empty = await runCheck(config);
  assert.equal(empty.code, 0, empty.stderr);
  const result = JSON.parse(empty.stdout);
  assert.equal(result.protocol, "ok");
  assert.equal(result.paid_requests, 0);
  assert.deepEqual(result.tools, ["audio_get_capabilities", "audio_generate", "audio_get_job"]);
  assert.equal(result.capabilities.seed_audio.configured, false);
  assert.equal(result.capabilities.narration.configured, false);
  assert.equal(result.capabilities.output_dir, join(root, "audio"));

  await writeFile(config, JSON.stringify({ dataDir: "./state", seedAudio: { apiKey: "offline-self-check-key" } }));
  const configured = await runCheck(config);
  assert.equal(configured.code, 0, configured.stderr);
  assert.equal(JSON.parse(configured.stdout).capabilities.seed_audio.configured, true);
  assert.equal((configured.stdout + configured.stderr).includes("offline-self-check-key"), false);

  await writeFile(config, '{"unknown-secret":"offline-invalid-key"}');
  const invalid = await runCheck(config);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /self-check failed/);
  assert.equal(invalid.stderr.includes("offline-invalid-key"), false);
}));

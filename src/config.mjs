import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";

export class AudioMcpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const credential = z.object({ apiKey: z.string().optional(), apiKeyFile: z.string().optional() }).strict();
const voices = z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(120) }).strict()).max(200);
const schema = z.object({
  dataDir: z.string().min(1).optional(), outputDir: z.string().min(1).optional(),
  seedAudio: credential.optional(),
  narration: credential.extend({ resourceId: z.string().trim().max(200).optional(), voices: voices.optional() }).strict().optional(),
}).strict();

function endpoint(value, fallback) {
  let url;
  try { url = new URL(value || fallback); } catch { throw new Error(); }
  if (url.username || url.password || url.hash || (url.protocol !== "https:"
    && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new Error();
  return url.toString();
}

function apiKey(env, prefix, section, base) {
  const file = env[`${prefix}_API_KEY_FILE`] || (!env[`${prefix}_API_KEY`] && section?.apiKeyFile);
  const key = (file ? readFileSync(resolve(base, file), "utf8") : env[`${prefix}_API_KEY`] || section?.apiKey || "").trim();
  if (key && (!/^[\x21-\x7e]+$/.test(key) || key.length > 4096)) throw new Error();
  return key;
}

// Configuration is operator-controlled, never accepted as a tool argument.
export function readConfiguration(env = process.env) {
  const file = env.AUDIO_MCP_CONFIG_FILE;
  let supplied = {};
  try { if (file) supplied = JSON.parse(readFileSync(resolve(file), "utf8")); }
  catch { throw new AudioMcpError("CONFIG_INVALID", "Cannot read the local audio MCP configuration JSON; check the file without sharing its secrets."); }
  const parsed = schema.safeParse(supplied);
  if (!parsed.success) throw new AudioMcpError("CONFIG_INVALID", "Invalid audio MCP configuration fields; use config.example.json.");
  const config = parsed.data, base = file ? dirname(resolve(file)) : process.cwd();
  const location = (value, fallback) => {
    if (!value) return fallback;
    if (!file && !isAbsolute(value)) throw new AudioMcpError("CONFIG_INVALID", "Directory environment variables must be absolute paths.");
    return resolve(base, value);
  };
  const dataDir = location(env.AUDIO_MCP_DATA_DIR || config.dataDir, resolve(homedir(), ".sounddock"));
  const outputDir = location(env.AUDIO_MCP_OUTPUT_DIR || config.outputDir, resolve(dataDir, "files"));
  let allowedVoices;
  try { allowedVoices = voices.parse(env.AUDIO_MCP_VOICES_JSON ? JSON.parse(env.AUDIO_MCP_VOICES_JSON) : config.narration?.voices || []); }
  catch { throw new AudioMcpError("CONFIG_INVALID", "Invalid configured narration voices; supply objects with id and name."); }
  if (new Set(allowedVoices.map(voice => voice.id)).size !== allowedVoices.length) throw new AudioMcpError("CONFIG_INVALID", "Configured narration voice IDs must be unique.");
  const seed = { key: "", address: "", error: null }, narration = { key: "", resourceId: "", address: "", voices: allowedVoices, error: null };
  try {
    seed.key = apiKey(env, "SEEDAUDIO", config.seedAudio, base);
    seed.address = endpoint(env.SEEDAUDIO_API_URL, "https://openspeech.bytedance.com/api/v3/tts/create");
  } catch { seed.error = "Cannot read the SeedAudio key or endpoint; fix the local configuration."; }
  try {
    narration.key = apiKey(env, "NARRATION", config.narration, base);
    narration.resourceId = (env.NARRATION_RESOURCE_ID || config.narration?.resourceId || "").trim();
    if (narration.resourceId && !/^[\x21-\x7e]{1,200}$/.test(narration.resourceId)) throw new Error();
    narration.address = endpoint(env.AUDIO_MCP_NARRATION_API_URL, "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse");
  } catch { narration.error = "Cannot read the narration key, resource or endpoint; fix the local configuration."; }
  return { dataDir, outputDir, seed, narration };
}

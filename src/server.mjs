import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AudioMcpError } from "./config.mjs";
import { AudioJobs } from "./jobs.mjs";
import { generateSeedAudio, SeedAudioError } from "./seedaudio.ts";
import { synthesizeNarration, NarrationError } from "./narration.ts";
import { inspectNarrationAudio } from "./audio-format.ts";
import { NARRATION_PARAMETER_FIELDS, narrationParameters } from "./narration-fields.ts";
import { validateNarrationResource } from "./narration-parameters.ts";
import { AUDIO_LIMIT, RESOURCE_AUDIO_LIMIT } from "./limits.ts";

const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).describe("Stable ID for this user-authorized generation. Reuse it after any timeout or disconnect; never generate a new ID just to retry.");
const waitSeconds = z.number().int().min(0).max(25).default(20).describe("Wait briefly for completion. If still processing, poll audio_get_job using the same request_id.");
const parameters = z.object(Object.fromEntries(NARRATION_PARAMETER_FIELDS.filter(field => field.key !== "format").map(field => [field.key,
  (typeof field.default === "string" ? z.string() : typeof field.default === "number" ? z.number() : z.boolean()).optional().describe(field.help || field.label),
]))).strict();

function result(data, isError = false) {
  const content = [{ type: "text", text: JSON.stringify(data) }];
  if (data.job?.file) content.push({ type: "resource_link", uri: data.job.resource_uri, name: `${data.job.title || data.job.kind}.${data.job.format}`, mimeType: data.job.file.content_type,
    description: "The generated file is already saved at job.file.path. Read this resource only if audio bytes are needed (6 MiB resource limit)." });
  return { content, structuredContent: data, isError };
}

function normalize(input, config) {
  const common = { kind: input.kind, title: input.title || "", format: input.format };
  if (input.kind !== "narration") {
    if (!input.prompt?.trim() || input.text !== undefined || input.voice_id !== undefined || input.parameters !== undefined)
      throw new AudioMcpError("INVALID_INPUT", "Sound effects/BGM require prompt and must not include narration-only fields.");
    return { ...common, prompt: input.prompt.trim() };
  }
  if (input.prompt !== undefined || !input.text?.trim() || !input.voice_id || Buffer.byteLength(input.text, "utf8") > 65536)
    throw new AudioMcpError("INVALID_INPUT", "Narration requires text (up to 64 KiB UTF-8) and an explicit configured voice_id; prompt is not spoken text.");
  if (!config.narration.voices.some(voice => voice.id === input.voice_id))
    throw new AudioMcpError("VOICE_NOT_CONFIGURED", "Choose an explicit voice_id returned by audio_get_capabilities. Voices are never inferred or automatically designed.");
  let effective;
  try {
    effective = narrationParameters({ ...input.parameters, format: input.format });
    validateNarrationResource(effective, config.narration.resourceId);
  } catch (error) { throw new AudioMcpError("INVALID_PARAMETERS", error.message); }
  return { ...common, text: input.text, voice_id: input.voice_id, resource_id: config.narration.resourceId, parameters: effective };
}

export function createAudioMcpServer(config) {
  const jobs = new AudioJobs(config), pending = new Map();
  const server = new McpServer({ name: "sounddock-mcp", version: "0.1.0" }, { instructions:
    "Generate audio directly from a user's request; no board, document, requirement or adoption step is needed. Inspect capabilities first. Generation can incur charges. Use a stable request_id per authorized output. Poll audio_get_job, never resubmit with a new ID after a timeout. Failed/uncertain jobs never automatically replay. Ready files are already saved locally; return or copy job.file.path into the user's project. Narration must use an explicitly selected configured voice. Do not claim precise duration or seamless looping unless verified by listening." });

  function jobResult(job) {
    return result({ accepted: true, job: jobs.summary(job) }, ["failed", "uncertain"].includes(job.status));
  }

  async function wait(request, seconds) {
    const deadline = Date.now() + seconds * 1000;
    let job;
    do {
      job = jobs.find(request);
      if (!job || job.status !== "processing" || Date.now() >= deadline) return job;
      await setTimeout(Math.min(100, deadline - Date.now()));
    } while (true);
  }

  function safeError(error) {
    return result({ accepted: error instanceof AudioMcpError ? false : null, code: error instanceof AudioMcpError ? error.code : "LOCAL_ERROR",
      message: error instanceof AudioMcpError ? error.message : "Local operation could not be confirmed. Query the original request_id before doing anything else; check local storage and configuration." }, true);
  }

  server.registerTool("audio_get_capabilities", {
    description: "Inspect local audio generation readiness, configured narration voices, output directory, limits and cost/retry rules. Does not call a paid provider or reveal keys.",
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => result({
    output_dir: jobs.outputDir,
    seed_audio: { configured: !!config.seed.key && !config.seed.error, kinds: ["sfx", "bgm"], model: "seed-audio-1.0", error: config.seed.error,
      missing: config.seed.key ? [] : ["api_key"] },
    narration: { configured: !!config.narration.key && !!config.narration.resourceId && !!config.narration.voices.length && !config.narration.error,
      resource_id: config.narration.resourceId, voices: config.narration.voices, error: config.narration.error,
      missing: [...(config.narration.key ? [] : ["api_key"]), ...(config.narration.resourceId ? [] : ["resource_id"]), ...(config.narration.voices.length ? [] : ["voices"])] },
    limits: { formats: ["wav", "mp3"], default_format: "wav", seed_prompt_max_characters: 3000, seed_max_output_seconds: 120,
      narration_max_text_utf8_bytes: 65536, max_file_bytes: AUDIO_LIMIT, embedded_resource_max_bytes: RESOURCE_AUDIO_LIMIT, upstream_timeout_seconds: 300 },
    rules: ["Generation may incur provider charges even when no usable result is returned.", "Use prompt for SFX/BGM; duration, loop and musical direction belong in that description and are not exact guarantees.",
      "Narration text is spoken; parameters.context_text is unspoken direction. ICL2 direction needs the expressive model.",
      "One generation at a time per shared data directory; BUSY means no new request was accepted. Keep that request_id when trying later.",
      "Same request_id and same normalized input returns the existing job, including failed/uncertain jobs. Never automatically replay them.",
      "Configuration and job state are separate from the board; board credentials, permissions and voice design are not imported automatically."],
  }));

  server.registerTool("audio_generate", {
    description: "Generate one user-requested sound effect, BGM or narration and save the actual WAV/MP3 locally. May incur charges. No document, board request, adoption or manual download. Reuse request_id after response loss; use audio_get_job for polling, not a fresh generation.",
    inputSchema: { request_id: requestId, kind: z.enum(["sfx", "bgm", "narration"]), title: z.string().trim().max(120).optional(),
      prompt: z.string().trim().min(1).max(3000).optional().describe("SFX/BGM description, including desired duration and musical/loop direction. Not narration text."),
      text: z.string().min(1).max(65536).optional().describe("Actual narration to speak, not a description of the voice."),
      voice_id: z.string().min(1).max(200).optional().describe("Explicit ID from configured narration voices; never guess a voice."),
      format: z.enum(["wav", "mp3"]).default("wav"), parameters: parameters.optional().describe("Narration-only options. Format is selected using the top-level format field."), wait_seconds: waitSeconds },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async input => {
    try {
      const effective = normalize(input, config);
      const existing = jobs.find(input.request_id);
      const connection = input.kind === "narration" ? config.narration : config.seed;
      if (!existing && (!connection.key || connection.error || (input.kind === "narration" && !connection.resourceId)))
        throw new AudioMcpError("NOT_CONFIGURED", "The requested provider is not configured. Check audio_get_capabilities and local configuration; no generation was accepted.");
      const claimed = jobs.claim(input.request_id, effective);
      if (claimed.created) {
        const work = (async () => {
          try {
            let generated;
            if (effective.kind === "narration") {
              generated = await synthesizeNarration({ id: claimed.job.id, author_id: "sounddock-mcp", speaker_id: effective.voice_id, narration_text: effective.text,
                format: effective.format, speech_rate: effective.parameters.speech_rate, sample_rate: effective.parameters.sample_rate, parameters_json: JSON.stringify(effective.parameters) }, connection);
            } else {
              generated = await generateSeedAudio(claimed.job.id, effective.prompt, effective.format, connection);
              const metadata = inspectNarrationAudio(generated.bytes, AUDIO_LIMIT);
              if (metadata.extension !== effective.format || metadata.sampleRate !== 24000) throw new Error("Unexpected audio format");
              generated = { ...generated, ...metadata };
            }
            jobs.complete(claimed.job, effective, generated);
          } catch (error) {
            const known = error instanceof SeedAudioError || error instanceof NarrationError;
            jobs.fail(claimed.job, known ? error.message : "Audio generation or local saving could not be confirmed. Check the result and charges; no automatic retry will occur.", known ? error.uncertain : true);
          }
        })().catch(() => { console.error("Audio job persistence failed; query the original request after checking local storage. No generation will be replayed."); }).finally(() => pending.delete(input.request_id));
        pending.set(input.request_id, work);
      }
      return jobResult(await wait(input.request_id, input.wait_seconds));
    } catch (error) { return safeError(error); }
  });

  server.registerTool("audio_get_job", {
    description: "Read or briefly await an already accepted audio job. Safe after a timeout, restart or disconnect; never sends or retries a paid request. Ready results contain the saved absolute file path.",
    inputSchema: { request_id: requestId, wait_seconds: waitSeconds },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ request_id, wait_seconds }) => {
    try {
      const job = await wait(request_id, wait_seconds);
      if (!job) throw new AudioMcpError("NOT_FOUND", "No accepted job has this request_id in this data directory.");
      return jobResult(job);
    } catch (error) { return safeError(error); }
  });

  server.registerResource("generated-audio", new ResourceTemplate("sounddock://jobs/{id}/audio", { list: undefined }),
    { description: "Original generated audio, read on demand only. Files over 6 MiB must be used through their saved local path." }, async (uri, { id }) => {
      const job = typeof id === "string" && /^[a-f0-9-]{36}$/.test(id) ? jobs.findId(id) : null;
      if (!job || job.status !== "ready") throw new McpError(ErrorCode.InvalidParams, "No ready audio exists for this job.");
      const file = JSON.parse(job.result_json);
      if (file.byte_size > RESOURCE_AUDIO_LIMIT) throw new McpError(ErrorCode.InvalidParams, "Audio exceeds the 6 MiB resource limit. Use the absolute path in audio_get_job.");
      const chunks = []; let size = 0;
      try {
        for await (const chunk of createReadStream(file.path)) {
          size += chunk.length;
          if (size > file.byte_size) throw new Error();
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (size !== file.byte_size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error();
        return { contents: [{ uri: uri.href, mimeType: file.content_type, blob: bytes.toString("base64") }] };
      } catch { throw new McpError(ErrorCode.InternalError, "The saved audio is missing or changed; do not regenerate automatically."); }
    });
  return { server, jobs, drain: () => Promise.all(pending.values()) };
}

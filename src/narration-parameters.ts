import { narrationParameters, DEFAULT_NARRATION_PARAMETERS, type NarrationParameters } from "./narration-fields.ts";

export function storedNarrationParameters(task: { parameters_json?: string; format: string; speech_rate: number; sample_rate: number }) {
  return narrationParameters({ ...JSON.parse(task.parameters_json ?? "{}"), format: task.format, speech_rate: task.speech_rate, sample_rate: task.sample_rate });
}
export function validateNarrationResource(parameters: NarrationParameters, resource: string) {
  if (parameters.model === "seed-tts-2.0-expressive" && resource !== "seed-icl-2.0") throw new Error("表现力增强模型仅支持声音复刻 ICL 2.0 资源");
  if ((parameters.context_text || parameters.use_tag_parser) && resource === "seed-icl-2.0" && parameters.model !== "seed-tts-2.0-expressive") throw new Error("语气指令或 CoT 标签须选择表现力增强版模型");
  if (parameters.use_tag_parser && resource !== "seed-icl-2.0") throw new Error("CoT 标签仅支持声音复刻 ICL 2.0 表现力增强版");
  if ((parameters.context_text || parameters.section_id) && !["seed-icl-2.0", "seed-tts-2.0"].includes(resource)) throw new Error("语气指令和上下文 ID 需要 2.0 资源");
  if (resource === "seed-icl-2.0" && ["de", "fr", "crosslingual"].includes(parameters.explicit_language)) throw new Error("当前 ICL 2.0 音色不支持该明确语种");
}
export function narrationUpstreamParameters(parameters: NarrationParameters) {
  const p = parameters, audio: Record<string, unknown> = { format: p.format, sample_rate: p.sample_rate, speech_rate: p.speech_rate }, additions: Record<string, unknown> = {};
  if (p.loudness_rate) audio.loudness_rate = p.loudness_rate;
  if (p.emotion) { audio.emotion = p.emotion; audio.emotion_scale = p.emotion_scale; }
  if (p.format === "mp3" && p.bit_rate) audio.bit_rate = p.bit_rate;
  for (const key of ["silence_duration", "explicit_language", "context_language", "enable_language_detector", "disable_markdown_filter", "disable_emoji_filter", "enable_latex_tn", "latex_parser", "max_length_to_filter_parenthesis", "unsupported_char_ratio_thresh", "use_tag_parser", "section_id", "aigc_watermark"] as const) {
    if (p[key] !== DEFAULT_NARRATION_PARAMETERS[key]) additions[key] = p[key];
  }
  if (p.format === "mp3" && p.disable_default_bit_rate) additions.disable_default_bit_rate = true;
  if (p.pitch) additions.post_process = { pitch: p.pitch };
  if (p.context_text) additions.context_texts = [p.context_text];
  if (p.use_cache) additions.cache_config = { text_type: 1, use_cache: true };
  if (p.metadata_enable) additions.aigc_metadata = { enable: true, content_producer: p.content_producer, produce_id: p.produce_id, content_propagator: p.content_propagator, propagate_id: p.propagate_id };
  return { audio_params: audio, ...(p.model !== DEFAULT_NARRATION_PARAMETERS.model ? { model: p.model } : {}), ...(Object.keys(additions).length ? { additions: JSON.stringify(additions) } : {}) };
}

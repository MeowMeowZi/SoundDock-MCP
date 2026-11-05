// One vocabulary for request forms, imports, validation and frozen generation
// snapshots. These are product controls, not arbitrary upstream JSON.
type Field = { key: string; label: string; default: string | number | boolean; kind: "select" | "number" | "text" | "boolean"; options?: readonly (string | number)[]; min?: number; max?: number; step?: number; help?: string; basic?: boolean };
export const NARRATION_PARAMETER_FIELDS = [
  { key: "format", label: "输出格式", default: "wav", kind: "select", options: ["wav", "mp3"], basic: true },
  { key: "sample_rate", label: "采样率", default: 24000, kind: "select", options: [8000, 16000, 22050, 24000, 32000, 44100, 48000], basic: true },
  { key: "speech_rate", label: "语速", default: 0, kind: "number", min: -50, max: 100, step: 1, basic: true, help: "0 正常，-50 为 0.5 倍，100 为 2 倍。" },
  { key: "loudness_rate", label: "音量", default: 0, kind: "number", min: -50, max: 100, step: 1, basic: true, help: "0 正常，-50 为 0.5 倍，100 为 2 倍。" },
  { key: "pitch", label: "音调", default: 0, kind: "number", min: -12, max: 12, step: 1, basic: true },
  { key: "model", label: "表现力模型", default: "seed-tts-2.0-standard", kind: "select", options: ["seed-tts-2.0-standard", "seed-tts-2.0-expressive"], basic: true, help: "仅 ICL 2.0：标准版延时更优；表现力增强版支持语气指令和 CoT 标签。" },
  { key: "context_text", label: "语气指令", default: "", kind: "text", max: 2000, basic: true, help: "写明对谁说、说话目的、情绪转折及必要的停连和重音，如：对终于赴约的同伴，先轻微埋怨，随后松口气、放轻声音。此列会传给语音模型，不作为台词；需求说明不会自动转成指令。ICL 2.0 须选择表现力增强版。" },
  { key: "emotion", label: "情绪", default: "", kind: "text", max: 64, help: "留空由音色决定；如 happy、sad、angry。仅部分音色支持，取值以该音色能力为准。" },
  { key: "emotion_scale", label: "情绪强度", default: 4, kind: "number", min: 1, max: 5, step: 0.1, help: "仅填写情绪时生效，1–5，默认 4；效果并非线性。" },
  { key: "bit_rate", label: "MP3码率", default: 0, kind: "select", options: [0, 16000, 32000, 48000, 64000, 96000, 128000, 160000], help: "0 使用服务默认值；仅 MP3 生效，低于 64000 须开启低码率。" },
  { key: "disable_default_bit_rate", label: "允许低码率MP3", default: false, kind: "boolean" },
  { key: "silence_duration", label: "句尾静音", default: 0, kind: "number", min: 0, max: 30000, step: 1, help: "毫秒，仅在整段台词末尾增加静音。" },
  { key: "explicit_language", label: "明确语种", default: "", kind: "select", options: ["", "zh-cn", "en", "ja", "es-mx", "id", "pt-br", "ko", "de", "fr", "crosslingual"], help: "留空正常中英混读；其他语种须音色和资源支持。ICL2 非中英文需对应语种的音色与台词，不支持跨语种。" },
  { key: "context_language", label: "参考语种", default: "", kind: "select", options: ["", "id", "es", "pt"], help: "为西欧文本提供参考语种；留空使用服务默认。" },
  { key: "enable_language_detector", label: "自动识别语种", default: false, kind: "boolean" },
  { key: "disable_markdown_filter", label: "过滤Markdown标记", default: false, kind: "boolean", help: "开启后 **你好** 读作“你好”。" },
  { key: "disable_emoji_filter", label: "保留Emoji", default: false, kind: "boolean" },
  { key: "enable_latex_tn", label: "朗读LaTeX公式", default: false, kind: "boolean", help: "须同时开启过滤 Markdown 标记。" },
  { key: "latex_parser", label: "LaTeX解析器", default: "", kind: "select", options: ["", "v2"], help: "v2 使用增强公式解析，须同时开启过滤 Markdown 标记。" },
  { key: "max_length_to_filter_parenthesis", label: "过滤括号内容", default: 100, kind: "select", options: [100, 0], help: "100 过滤，0 不过滤；默认 100。" },
  { key: "unsupported_char_ratio_thresh", label: "不支持字符比例阈值", default: 0.3, kind: "number", min: 0, max: 1, step: 0.01 },
  { key: "use_tag_parser", label: "解析CoT语音标签", default: false, kind: "boolean", help: "仅 ICL2 表现力增强版；在台词中填写 <cot text=语气>…</cot>，建议单句少于 64 字。" },
  { key: "section_id", label: "上下文ID", default: "", kind: "text", max: 128, help: "留空不关联历史；同一 ID 的串行请求可引用上游会话历史，仅 2.0 支持。" },
  { key: "use_cache", label: "使用上游缓存", default: false, kind: "boolean", help: "相同文本可使用上游约一小时缓存；不保证本次重新演绎。" },
  { key: "aigc_watermark", label: "结尾音频节奏标识", default: false, kind: "boolean" },
  { key: "metadata_enable", label: "隐式元数据水印", default: false, kind: "boolean" },
  { key: "content_producer", label: "内容制作方", default: "", kind: "text", max: 256 },
  { key: "produce_id", label: "内容制作编号", default: "", kind: "text", max: 256 },
  { key: "content_propagator", label: "内容传播方", default: "", kind: "text", max: 256 },
  { key: "propagate_id", label: "内容传播编号", default: "", kind: "text", max: 256 },
] as const satisfies readonly Field[];
export type NarrationParameterKey = typeof NARRATION_PARAMETER_FIELDS[number]["key"];
type Widen<T> = T extends string ? string : T extends number ? number : boolean;
export type NarrationParameters = { [F in typeof NARRATION_PARAMETER_FIELDS[number] as F["key"]]: Widen<F["default"]> };
export const DEFAULT_NARRATION_PARAMETERS = Object.fromEntries(NARRATION_PARAMETER_FIELDS.map(field => [field.key, field.default])) as NarrationParameters;

// Keep copied spreadsheet guidance aligned with the same limits used by forms
// and validation; resource-specific dependencies supplement those field rules.
export function narrationParameterRequirement(field: Field) {
  const requirements = [`可留空；默认：${field.default === "" ? "留空（服务默认）" : String(field.default)}`];
  if (field.options) requirements.push(`仅填：${field.options.map(option => option === "" ? "留空" : String(option)).join("、")}`);
  if (field.kind === "number") requirements.push(`范围：${field.min} 至 ${field.max}${field.step === 1 ? "，须为整数" : "，可用小数"}`);
  if (field.kind === "text") requirements.push(`最多 ${field.max} 字`);
  if (field.kind === "boolean") requirements.push("填 true／false、是／否 或 1／0");
  if (field.help) requirements.push(field.help);
  if (field.key === "sample_rate") requirements.push("单位 Hz；不控制 PCM 位深");
  if (field.key === "bit_rate") requirements.push("单位 bps");
  if (field.key === "explicit_language") requirements.push("中文填 zh-cn，不是 cn；ICL2 不支持 de、fr、crosslingual");
  if (field.key === "context_language") requirements.push("不支持 cn 或 zh-cn；中文请留空");
  if (["model", "context_text", "use_tag_parser"].includes(field.key)) requirements.push("ICL2 使用语气指令或 CoT 时，表现力模型须填 seed-tts-2.0-expressive；此模型仅支持 ICL2 资源");
  if (["context_text", "section_id"].includes(field.key)) requirements.push("须使用 2.0 资源");
  if (["content_producer", "produce_id", "content_propagator", "propagate_id"].includes(field.key)) requirements.push("仅隐式元数据水印为 true 时生效");
  return requirements.join("；");
}

export function narrationParameters(input: unknown = {}): NarrationParameters {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("旁白参数格式无效");
  const supplied = input as Record<string, unknown>, result = { ...DEFAULT_NARRATION_PARAMETERS };
  for (const key of Object.keys(supplied)) if (!NARRATION_PARAMETER_FIELDS.some(field => field.key === key)) throw new Error(`未知旁白参数：${key}`);
  for (const field of NARRATION_PARAMETER_FIELDS as readonly Field[]) {
    const value = supplied[field.key] === undefined ? field.default : supplied[field.key];
    if (typeof value !== typeof field.default) throw new Error(`${field.label}类型无效`);
    if (field.kind === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < field.min! || value > field.max! || (field.step === 1 && !Number.isSafeInteger(value)))) throw new Error(`${field.label}需为 ${field.min} 至 ${field.max}${field.step === 1 ? " 的整数" : ""}`);
    if (field.options && !field.options.includes(value as string | number)) throw new Error(`${field.label}取值无效`);
    if (field.kind === "text" && (typeof value !== "string" || value.length > field.max!)) throw new Error(`${field.label}最多 ${field.max} 字`);
    Object.assign(result, { [field.key]: typeof value === "string" ? value.trim() : value });
  }
  if ((result.enable_latex_tn || result.latex_parser) && !result.disable_markdown_filter) throw new Error("朗读 LaTeX 公式须开启「过滤Markdown标记」");
  if (result.format === "mp3" && result.bit_rate && result.bit_rate < 64000 && !result.disable_default_bit_rate) throw new Error("MP3 码率低于 64000 须开启「允许低码率MP3」");
  return result;
}
export function narrationParameterLabel(key: NarrationParameterKey, value: string | number | boolean) {
  if (key === "format") return String(value).toUpperCase();
  if (key === "sample_rate") return `${value} Hz`;
  if (key === "model") return value === "seed-tts-2.0-expressive" ? "表现力增强版" : "标准版（默认）";
  if (key === "bit_rate" && value === 0) return "服务默认";
  if (key === "max_length_to_filter_parenthesis") return value === 100 ? "过滤（默认）" : "不过滤";
  if (typeof value === "boolean") return value ? "是" : "否";
  return value === "" ? "服务默认" : String(value);
}
export function narrationParameterSummary(value: Partial<NarrationParameters> = {}) {
  const parameters = { ...DEFAULT_NARRATION_PARAMETERS, ...value };
  return NARRATION_PARAMETER_FIELDS.filter(field => field.key === "format" || field.key === "sample_rate" || parameters[field.key] !== field.default).map(field => `${field.label}：${narrationParameterLabel(field.key, parameters[field.key])}`).join(" · ");
}

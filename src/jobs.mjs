import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AudioMcpError } from "./config.mjs";

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function filename(title, kind, format) {
  let name = (title || kind).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/[. ]+$/g, "");
  // Bound bytes as well as characters for filesystems with a 255-byte limit.
  let bounded = "";
  for (const character of name) {
    if (Buffer.byteLength(bounded + character, "utf8") > 200) break;
    bounded += character;
  }
  name = bounded.replace(/[. ]+$/g, "");
  if (!name) name = kind;
  if (/^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.${format}`;
}

export class AudioJobs {
  constructor(config) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    mkdirSync(config.outputDir, { recursive: true, mode: 0o700 });
    this.outputDir = realpathSync(config.outputDir);
    this.db = new DatabaseSync(join(config.dataDir, "jobs.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (
        request_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
        input_json TEXT NOT NULL, status TEXT NOT NULL, owner_pid INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, result_json TEXT,
        error_code TEXT, message TEXT
      )`);
  }

  recover() {
    for (const job of this.db.prepare("SELECT id, owner_pid FROM jobs WHERE status='processing'").all()) {
      if (!alive(job.owner_pid)) this.db.prepare("UPDATE jobs SET status='uncertain', error_code='RESULT_UNCERTAIN', message=?, updated_at=? WHERE id=? AND status='processing'")
        .run("The generating process stopped. Result and charges require reconciliation; this request will not be sent again.", new Date().toISOString(), job.id);
    }
  }

  find(requestId) {
    this.recover();
    return this.db.prepare("SELECT * FROM jobs WHERE request_id=?").get(requestId);
  }

  findId(id) {
    this.recover();
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  }

  claim(requestId, input) {
    const json = JSON.stringify(input), fingerprint = createHash("sha256").update(json).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.find(requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AudioMcpError("REQUEST_ID_CONFLICT", "This request_id belongs to different input. Query its existing result; do not change IDs to retry an uncertain generation.");
        this.db.exec("COMMIT");
        return { job: existing, created: false };
      }
      const active = this.db.prepare("SELECT request_id FROM jobs WHERE status='processing' LIMIT 1").get();
      if (active) throw new AudioMcpError("BUSY", `Another generation is running (${active.request_id}). No new request was accepted or sent; retry this same request_id after it finishes.`);
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO jobs(request_id,id,fingerprint,input_json,status,owner_pid,created_at,updated_at) VALUES(?,?,?,?,'processing',?,?,?)")
        .run(requestId, id, fingerprint, json, process.pid, now, now);
      const job = this.db.prepare("SELECT * FROM jobs WHERE request_id=?").get(requestId);
      this.db.exec("COMMIT");
      return { job, created: true };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  complete(job, input, generated) {
    const directory = join(this.outputDir, job.id);
    mkdirSync(directory, { mode: 0o700 });
    const path = join(directory, filename(input.title, input.kind, input.format));
    writeFileSync(path, generated.bytes, { flag: "wx", mode: 0o600 });
    const result = { path, content_type: input.format === "wav" ? "audio/wav" : "audio/mpeg", byte_size: generated.bytes.length,
      sha256: createHash("sha256").update(generated.bytes).digest("hex"), duration: generated.duration,
      original_duration: generated.originalDuration ?? null, sample_rate: generated.sampleRate ?? 24000 };
    this.db.prepare("UPDATE jobs SET status='ready', result_json=?, updated_at=? WHERE id=? AND status='processing' AND owner_pid=?")
      .run(JSON.stringify(result), new Date().toISOString(), job.id, process.pid);
  }

  fail(job, message, uncertain) {
    this.db.prepare("UPDATE jobs SET status=?, error_code=?, message=?, updated_at=? WHERE id=? AND status='processing' AND owner_pid=?")
      .run(uncertain ? "uncertain" : "failed", uncertain ? "RESULT_UNCERTAIN" : "PROVIDER_REJECTED", message, new Date().toISOString(), job.id, process.pid);
  }

  summary(job) {
    const input = JSON.parse(job.input_json);
    return { request_id: job.request_id, job_id: job.id, status: job.status, kind: input.kind, title: input.title, format: input.format,
      created_at: job.created_at, updated_at: job.updated_at, ...(job.result_json ? { file: JSON.parse(job.result_json), resource_uri: `sounddock://jobs/${job.id}/audio` } : {}),
      ...(job.error_code ? { code: job.error_code, message: job.message } : {}),
      next_action: job.status === "processing" ? "Call audio_get_job with the same request_id; never submit a replacement ID to poll."
        : job.status === "ready" ? "The file is already saved locally. Use its absolute path; no manual download or board delivery is needed."
          : "Do not automatically regenerate. Check the result/charges and obtain explicit authorization before a genuinely new request." };
  }

  close() { this.db.close(); }
}

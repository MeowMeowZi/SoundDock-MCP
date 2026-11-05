import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = {};
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
  if (process.env[key]) env[key] = process.env[key];
// Never inherit live provider credentials, dotenv hooks or proxy settings.
env.NODE_OPTIONS = `--import=${new URL("../tests/helpers/network-guard.mjs", import.meta.url).href}`;
const files = (await readdir(new URL("../tests/", import.meta.url))).filter(file => file.endsWith(".test.mjs")).sort();
if (!files.length) throw new Error("No standalone tests found.");
const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files.map(file => `tests/${file}`)],
  { cwd: root, env, stdio: "inherit", windowsHide: true });
child.on("error", () => { console.error("Could not start the isolated test runner."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });

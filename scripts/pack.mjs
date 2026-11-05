import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const files = ["package.json", "package-lock.json", "server.mjs", "README.md", "AGENTS.md", "config.example.json", ".gitignore", ".gitattributes"];
async function collect(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error("Release sources must be regular files and directories.");
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) {
      const source = /^(?:src|scripts|tests)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:mjs|ts)$/.test(path);
      const example = /^examples\/[A-Za-z0-9_.-]+\.(?:json|toml)$/.test(path);
      if (!source && !example) throw new Error(`Unrecognized release source: ${path}`);
      files.push(path);
    }
    else throw new Error("Unexpected release source type.");
  }
}
for (const directory of ["src", "scripts", "tests", "examples"]) await collect(directory);
const archive = {}, checksums = [];
const mtime = new Date(2026, 0, 1);
for (const file of files.sort()) {
  if (/(?:^|\/)(?:node_modules|config\.local\.json|\.env(?:\.|$)|state|output|work|dist|\.secrets)(?:\/|$)|\.(?:key|pem|sqlite|log)$/i.test(file))
    throw new Error("A private or generated file was found in the release allowlist.");
  if (!(await lstat(join(root, file))).isFile()) throw new Error("Release sources must be regular files.");
  const bytes = await readFile(join(root, file));
  archive[`SoundDock-MCP/${file}`] = [new Uint8Array(bytes), { mtime }];
  checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${file}`);
}
archive["SoundDock-MCP/FILES.sha256"] = [new TextEncoder().encode(checksums.join("\n") + "\n"), { mtime }];
const dist = join(root, "dist"), name = `sounddock-mcp-${manifest.version}.zip`;
await mkdir(dist, { recursive: true });
const bytes = zipSync(archive, { level: 9 });
await writeFile(join(dist, name), bytes);
await writeFile(join(dist, "SHA256SUMS.txt"), `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
console.log(JSON.stringify({ archive: join(dist, name), files: files.length + 1, bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), dependencies: "Install from the included lockfile using npm ci." }, null, 2));

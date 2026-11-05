import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "sounddock-check", version: "0.1.0" });
const env = {};
for (const key of ["AUDIO_MCP_CONFIG_FILE", "AUDIO_MCP_DATA_DIR", "AUDIO_MCP_OUTPUT_DIR", "AUDIO_MCP_VOICES_JSON",
  "SEEDAUDIO_API_KEY", "SEEDAUDIO_API_KEY_FILE", "SEEDAUDIO_API_URL", "NARRATION_API_KEY", "NARRATION_API_KEY_FILE", "NARRATION_RESOURCE_ID", "AUDIO_MCP_NARRATION_API_URL", "NODE_OPTIONS"])
  if (process.env[key]) env[key] = process.env[key];
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL("../server.mjs", import.meta.url))], env, stderr: "pipe" });
// Drain diagnostics without echoing configuration or credential paths on errors.
transport.stderr.on("data", () => {});
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  const response = await client.callTool({ name: "audio_get_capabilities", arguments: {} });
  console.log(JSON.stringify({ protocol: "ok", node: process.version, tools, capabilities: response.structuredContent,
    paid_requests: 0, note: "Protocol readiness is not provider entitlement or sound-quality verification." }, null, 2));
} catch {
  console.error("SoundDock self-check failed. Check Node.js 24+, installed dependencies, the local JSON configuration and directory permissions.");
  process.exitCode = 1;
} finally { await client.close(); }

#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfiguration, AudioMcpError } from "./src/config.mjs";
import { createAudioMcpServer } from "./src/server.mjs";

try {
  const { server } = createAudioMcpServer(readConfiguration());
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof AudioMcpError ? `${error.code}: ${error.message}` : "Audio MCP could not start; check Node.js 24+, dependencies, configuration and local directory permissions.");
  process.exitCode = 1;
}

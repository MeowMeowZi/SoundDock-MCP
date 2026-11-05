# SoundDock MCP

For installation into an AI client or a game project, follow the ordered
instructions in `README.md` under "给 AI 的接入流程". That section is the canonical
installation guide, including missing-credential and remote-only-client cases.

For code changes:

- Keep this repository standalone: Node.js 24+ and the locked npm dependencies.
  Runtime entry points use Node's native type stripping, not a TypeScript build.
- Keep stdout exclusively for MCP protocol messages; diagnostics use stderr.
- Tests use synthetic audio, independent temporary state and loopback upstreams.
  Run `npm ci`, then `npm test`; the test command enables the network guard.
- Preserve durable acceptance, same-ID deduplication and conservative uncertain
  outcomes. Reading a job must never replay a paid generation.
- Publish only allowlisted source files. Credentials, local configuration, job
  databases and generated audio stay outside Git and release archives.

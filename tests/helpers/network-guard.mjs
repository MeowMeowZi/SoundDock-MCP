// A regression tripwire, not a sandbox for untrusted code or raw sockets.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

function allowed(url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
    throw new Error("Tests block external network; use a loopback mock upstream");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, ...args) => {
  allowed(input instanceof Request ? input.url : input);
  return originalFetch(input, ...args);
};
for (const transport of [http, https]) {
  for (const name of ["request", "get"]) {
    const original = transport[name];
    transport[name] = function (input, ...args) {
      if (typeof input === "string" || input instanceof URL) allowed(input);
      else if (!input?.socketPath) allowed(`http://${input?.hostname || input?.host || "localhost"}`);
      return original.call(this, input, ...args);
    };
  }
}
syncBuiltinESMExports();

// Register resources immediately and attempt every cleanup, even on failure.
export async function withTestResources(body) {
  const cleanups = [];
  const resources = { defer(label, cleanup) { cleanups.push({ label, cleanup }); } };
  let result, primary;
  try { result = await body(resources); } catch (error) { primary = error; }
  const failures = [];
  for (const { label, cleanup } of cleanups.reverse()) {
    try { await cleanup(); } catch (error) { failures.push(new Error(`${label}: ${error.message}`, { cause: error })); }
  }
  if (primary && !failures.length) throw primary;
  if (primary || failures.length) throw new AggregateError([...(primary ? [primary] : []), ...failures],
    [primary?.message, ...failures.map(error => error.message)].filter(Boolean).join("\n"), primary ? { cause: primary } : undefined);
  return result;
}

export async function closeTestServer(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { configureBugReportProxyTrust } from "../scripts/server-control-config.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Funnel restarts trust the loopback proxy before the server loads", () => {
  const environment = {};
  assert.equal(configureBugReportProxyTrust(environment, { useTunnel: true }), true);
  assert.equal(environment.RIFTBOUND_BUG_REPORT_TRUST_PROXY, "true");
});

test("local restarts and explicit proxy settings are preserved", () => {
  const localEnvironment = {};
  assert.equal(configureBugReportProxyTrust(localEnvironment, { useTunnel: false }), false);
  assert.equal("RIFTBOUND_BUG_REPORT_TRUST_PROXY" in localEnvironment, false);

  for (const explicit of ["false", "0", "true", ""]) {
    const environment = { RIFTBOUND_BUG_REPORT_TRUST_PROXY: explicit };
    assert.equal(configureBugReportProxyTrust(environment, { useTunnel: true }), false);
    assert.equal(environment.RIFTBOUND_BUG_REPORT_TRUST_PROXY, explicit);
  }
});

test("server control configures proxy trust before importing the server and honors --no-tunnel", async () => {
  const source = await readFile(path.join(projectRoot, "scripts", "server-control.mjs"), "utf8");
  assert.match(source, /!flags\.has\("--no-tunnel"\)/u);
  assert.ok(
    source.indexOf("configureBugReportProxyTrust(process.env, { useTunnel })")
      < source.indexOf('await import("./dev-server.mjs")'),
    "proxy trust must be configured before the bug-report handler singleton is imported"
  );
});

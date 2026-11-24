const BUG_REPORT_TRUST_PROXY_ENV = "RIFTBOUND_BUG_REPORT_TRUST_PROXY";

export function configureBugReportProxyTrust(environment, options = {}) {
  if (options.useTunnel !== true || environment[BUG_REPORT_TRUST_PROXY_ENV] !== undefined) return false;
  environment[BUG_REPORT_TRUST_PROXY_ENV] = "true";
  return true;
}

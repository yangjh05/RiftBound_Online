import { runCardRuleBehaviorProbes } from "./card-rules-probes.mjs";

const effectKey = process.argv[2];
const probes = (await runCardRuleBehaviorProbes()).filter((probe) => probe.covers?.includes(effectKey));
const failed = probes.filter((probe) => !probe.ok);
process.stdout.write(`${JSON.stringify({
  effectKey,
  status: !probes.length ? "invalid" : failed.length ? "killed" : "survived",
  probes: probes.map((probe) => probe.id),
  failed: failed.map((probe) => probe.id)
})}\n`);

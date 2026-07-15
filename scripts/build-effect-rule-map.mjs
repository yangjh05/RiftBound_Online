import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreRulesCatalog } from "./validate-rule-contracts.mjs";
import { buildEffectRuleMap, validateEffectRuleMap } from "./effect-rule-map.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "artifacts", "effect-rule-map.json");
const entries = buildEffectRuleMap();
const errors = validateEffectRuleMap(entries, coreRulesCatalog);
const report = {
  generatedAt: new Date().toISOString(),
  rulesVersion: coreRulesCatalog.rulesVersion,
  summary: {
    effectPairs: entries.length,
    mapped: entries.filter((entry) => entry.hasTimingFamily && entry.hasSemanticFamily).length,
    errors: errors.length
  },
  errors,
  entries
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
if (errors.length) {
  console.error(`Effect-to-rules mapping failed with ${errors.length} error(s). Report: ${path.relative(ROOT, OUTPUT)}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Mapped ${entries.length}/${entries.length} effect pairs to official timing and semantic rule families. Report: ${path.relative(ROOT, OUTPUT)}`);

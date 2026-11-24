import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {json, sha, immutable, verifyArtifact} from './deck-league-io.mjs';

// Prepare a separately versioned runtime. Never edit a running trainer's
// sealed files or claim semantic equivalence with the old Hidden rule.
const league = path.resolve('data/ai/deck-league-20261007');
const audit = path.resolve(process.argv[2] || 'data/ai/hidden-rule-repair-20261014');
const pointer = json(path.join(league, 'execution-active.json'));
const repairFile = path.join(league, pointer.directory, 'repair.json');
assert.equal(sha(repairFile), pointer.repairSha256);
const repair = json(repairFile);
const before = fs.readFileSync('.tmp-hidden-rule-fix-20261014/engine-before.mjs', 'utf8');
const fixed = fs.readFileSync('src/engine.mjs', 'utf8');
const functionText = (text, name) => text.match(new RegExp(`function ${name}\\([^]*?\\n}\\r?\\n`))?.[0];
const changedFunctions = ['pendingCardRetainsReactionPermission', 'legalCardPlayDestinations',
  'playHiddenCard', 'finalizeHiddenCard', 'triggerDeclaration',
  'cardHasReactionTimingPermission', 'hasKeyword', 'collectCardCostModifiers'];
const source = repair.trainingRuntime;
const directory = path.join(audit, 'runtime');
assert.ok(!fs.existsSync(directory), 'Never replace a prepared runtime.');
const oldManifest = json(verifyArtifact(source.manifest));
for (const entry of oldManifest) {
  const from = path.join(source.directory, entry.path), to = path.join(directory, entry.path);
  assert.equal(sha(from), entry.sha256, entry.path);
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.copyFileSync(from, to);
}
fs.symlinkSync(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'junction');
const engineFile = path.join(directory, 'src/engine.mjs');
let engine = fs.readFileSync(engineFile, 'utf8');
for (const name of changedFunctions) {
  const original = functionText(before, name), current = functionText(fixed, name);
  assert.ok(original && current, name);
  assert.equal(functionText(engine, name), original, `Unexpected runtime drift: ${name}`);
  engine = engine.replace(original, current);
}
assert.ok(!engine.includes('function hiddenCardPlayError('));
engine = engine.replace(functionText(engine, 'playHiddenCard'),
  functionText(fixed, 'hiddenCardPlayError') + '\n' + functionText(engine, 'playHiddenCard'));
assert.ok(!engine.includes('function hiddenGrantsReaction('));
engine = engine.replace(functionText(engine, 'cardHasReactionTimingPermission'),
  functionText(fixed, 'hiddenGrantsReaction') + '\n' + functionText(engine, 'cardHasReactionTimingPermission'));
fs.writeFileSync(engineFile, engine);
const testFile = 'tests/hidden-reaction-timing.test.mjs';
fs.copyFileSync(testFile, path.join(directory, testFile));
const result = spawnSync(process.execPath, ['--test', testFile], {cwd: directory, encoding: 'utf8'});
fs.writeFileSync(path.join(audit, 'focused-tests.log'), result.stdout + result.stderr);
assert.equal(result.status, 0, result.stdout + result.stderr);
const manifest = [...oldManifest.map(e => ({...e, sha256: sha(path.join(directory, e.path))})),
  {path: testFile, sha256: sha(path.join(directory, testFile))}];
assert.deepEqual(oldManifest.filter((entry, i) => entry.sha256 !== manifest[i].sha256).map(e => e.path), ['src/engine.mjs']);
const manifestFile = path.join(audit, 'runtime-manifest.json');
immutable(manifestFile, manifest);
const safety = await import(pathToFileURL(path.join(directory, 'scripts/training-safety.mjs')));
const fingerprint = safety.computeEngineFingerprint(directory);
assert.equal(fingerprint, safety.computeRawEngineFingerprint(directory), 'Rules change must have its own engine identity.');
assert.notEqual(fingerprint, source.engineFingerprint);
const runtime = {directory, manifest: {path: manifestFile, sha256: sha(manifestFile)}, engineFingerprint: fingerprint};
const record = {contract: 'hidden-rule-runtime-preparation-v1', at: new Date().toISOString(),
  previousPointer: pointer, previousRuntime: source, runtime, changedFunctions,
  changedFiles: ['src/engine.mjs'], addedFiles: [testFile], rulesBehaviorChanged: true,
  liveTrainingActivated: false, historicalArtifactsChanged: false,
  testEvidence: {path: path.join(audit, 'focused-tests.log'), sha256: sha(path.join(audit, 'focused-tests.log'))},
  purpose: 'Correct-rule replay and review intake; prospective live training/evaluation migration requires a separately recorded iteration boundary.'};
immutable(path.join(audit, 'prepared.json'), record);
console.log(JSON.stringify(record, null, 2));

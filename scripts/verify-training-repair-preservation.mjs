import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';import {unwrap} from './deck-league-contract.mjs';
const audit=path.resolve('data/ai/training-repair-20261013'),main=path.resolve('data/ai/deck-league-20261007'),study=path.resolve('data/ai/deck-league-individual-20261011-r2');
const read=f=>JSON.parse(gunzipSync(fs.readFileSync(f)));
const weights=json(path.join(audit,'preserved-weights.json')),archives=json(path.join(audit,'preserved-study-archives.json'));
weights.forEach(verifyArtifact);archives.forEach(verifyArtifact);
for(const root of [main,study])assert.equal(sha(path.join(root,'config.json')),sha(path.join(audit,path.basename(root),'sealed-before/config.json')),'Original config changed');
const previous=read(path.join(main,'execution-r6-evaluation/diagnostic-input-snapshot.json.gz')),current=read(path.join(main,'input-protection-live.json.gz'));
const trained=new Set(current.trained),protectedSet=new Set(current.protected);
assert.ok(previous.trained.every(k=>trained.has(k)));assert.equal(protectedSet.size,previous.protected.length);
assert.ok(previous.protected.every(k=>protectedSet.has(k)));assert.ok(current.protected.every(k=>!trained.has(k)));
const c=json(path.join(study,'config.json')),sett=c.profiles.find(p=>p.id==='sett'),source=unwrap(read(sett.champion.path));
const candidate=read(path.join(study,'profiles/sett/replay/candidate.json.gz'));
assert.deepEqual(source.weights,candidate.checkpoint.weights);
const result={at:new Date().toISOString(),passed:true,unchangedWeightArtifacts:weights.length,unchangedStudyArchives:archives.length,
 oldTrainedKeysPreserved:previous.trained.length,currentTrainedKeys:current.trained.length,protectedKeysUnchanged:previous.protected.length,
 inputRolesDisjoint:true,settFinalWeightsExactlyEqualSource:true,originalConfigsByteIdentical:true};
atomic(path.join(audit,'preservation-verification.json'),result);console.log(JSON.stringify(result));

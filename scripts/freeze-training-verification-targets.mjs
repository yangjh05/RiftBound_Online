import fs from 'node:fs';import path from 'node:path';
import {json,sha,immutable,verifyArtifact} from './deck-league-io.mjs';
const audit=path.resolve('data/ai/training-repair-20261013'),main=path.resolve('data/ai/deck-league-20261007'),study=path.resolve('data/ai/deck-league-individual-20261011-r2');
const requests=path.join(main,'evaluation-r6/requests'),execution=json(verifyArtifact(json(path.join(study,'execution-active.json'))));
const ref=file=>({path:file,sha256:sha(file)});
immutable(path.join(audit,'verification-targets.json'),{
 at:new Date().toISOString(),mainDirectory:main,studyDirectory:study,
 mainRequests:fs.readdirSync(requests).filter(f=>f.endsWith('.request.json')).sort().map(f=>ref(path.join(requests,f))),
 studyConfig:ref(path.join(study,'config.json')),studyPlan:execution.plan,studyProfiles:json(path.join(study,'config.json')).profiles.map(p=>p.id),
 constraints:{existingDataAndWeightsPreserved:true,originalStudyPlansOnly:true,maximumOwnPolicyGamesPerStudyProfile:28,maximumEpochsPerStudyProfile:4,
  unchangedTeacherProof:true,unchangedPromotionThresholds:true,screenGames:112,confirmationGames:896,failedExperimentsMustNotRepeat:true,
  evaluationLabelsNeverTrain:true,automaticStudyIntegration:false},
 completion:'Every frozen main request has a complete verified result or a recorded failure, and every original bounded study profile has its final update and evaluation result. Pause the follow-up, not the continuously running main league.'
});
console.log('Original fixed verification targets sealed');

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeActorId, actionKey, enumerateLegalActions, enumerateAiPolicyActions, cloneGame, applyAiAction, planPaymentActions } from "../src/ai/actions.mjs";
import {recommendPublicTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {recommendTacticalDemonstration} from './response-aware-demonstration.mjs';
import {recommendLocalResourceDemonstration} from './local-policy-learning.mjs';
import { reviewCombatContinuations } from "../src/ai/combat-safety.mjs";
import { encodeState, encodeActionSet, NEURAL_HIDDEN_SIZE, ACTION_DIM, CARD_BINS } from "../src/ai/neural/encoding.mjs";
import { createInformationSetHash } from "../src/ai/neural/teacher-contract.mjs";
import { createModel } from "../src/ai/policy.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { validIndependentLeafValueReference } from "../src/ai/neural/action-ranking-reference.mjs";
import { opponentPrivateInformationVisible } from "../src/ai/observation.mjs";
import { hiddenCardIsControlledBy } from "../src/rules/zones.mjs";
import { replaySubmittedGame, liveDigest } from "./live-game-replay.mjs";
import { captureGameReferences, restoreGameReferences } from "./game-state-references.mjs";
import { prepareDetachedLeafAuditJobs, runDetachedLeafAuditJobs } from "./detached-leaf-audit.mjs";
import { computeEngineFingerprint, assertTrainingTrajectories } from "./training-safety.mjs";
import { withFileLock } from "./file-lock.mjs";

export const LIVE_GAME_CONTRACT = "submitted-ai-game-curriculum-v1";
const fileHash = async file => createHash("sha256").update(await readFile(file)).digest("hex");
const optionalArchive = async file => { try { return await readTrajectoryArchive(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const bankFile = root => path.join(path.resolve(root), "manifest.json.gz");

// All positions, seeds and paired alternatives from one original game have
// one immutable role. Merely changing a report ID cannot cross the split.
export function liveGameRole(sourceGameId) {
  return parseInt(liveDigest([LIVE_GAME_CONTRACT, sourceGameId]).slice(0, 8), 16) % 5 === 0
    ? "validation" : "training";
}

export function liveGameDecisionComparisons(game, actorId, selected, { maximumAlternatives = 4,localResourceLessons=false } = {}) {
  if (game.pendingPayment || game.phase === "complete") return [];
  const legal = enumerateLegalActions(game, actorId);
  if (legal.length < 2 || !legal.some(a => actionKey(a) === actionKey(selected))) return [];
  if(localResourceLessons){
    const advice=recommendLocalResourceDemonstration(game,actorId,{action:selected,legalActions:enumerateAiPolicyActions(game,actorId)});
    if(advice)return [{category:'public-resource-savings',selected,alternative:advice.action,legal,hypothesisOnly:true}];
  }
  const actor = game.players.find(p => p.id === actorId);
  let category = null, alternatives = [];
  if (selected.kind === "passShowdown") {
    const review = reviewCombatContinuations(game, actorId, legal,
      { cloneGame, applyAiAction, planPaymentActions });
    if (review) { category = "combat-reassessment"; alternatives = review.comparisons.map(c => c.action); }
  } else if (selected.kind === "chooseEffectOption" && game.pendingChoice?.effect === "declarePlayTarget") {
    const heldEnemies = new Set(game.battlefields.filter(f => f.controlledBy && f.controlledBy !== actorId)
      .flatMap(f => f.units.filter(c => c.controllerId !== actorId).map(c => c.instanceId)));
    alternatives = legal.filter(a => a.kind === "chooseEffectOption" && heldEnemies.has(a.optionId));
    if (alternatives.some(a=>actionKey(a)!==actionKey(selected))) category = "score-denial-target";
  } else if (selected.kind === "beginPlayCard") {
    const card = actor.hand.find(c => c.instanceId === selected.cardId);
    const plays = legal.filter(a => a.kind === "beginPlayCard");
    const damageSpell = c => c?.type === "spell" && c.effects?.some(e => /damage/i.test(e.kind));
    const discountedAfterSetup=!actor.cardsPlayedThisTurn && card?.effects?.some(e=>
      e.kind==='costModifier' && e.requiresLegion && e.energy<0);
    if(discountedAfterSetup){
      category='card-order-discount';
      alternatives=plays.filter(a=>a.cardId!==selected.cardId);
    } else if (damageSpell(card)) {
      alternatives = plays.filter(a => {
        const other = actor.hand.find(c => c.instanceId === a.cardId);
        return damageSpell(other) && other.energy < card.energy;
      });
      if (alternatives.length) category = "reaction-reserve";
    } else if (card?.type === "unit" && game.battlefields.some(f => !f.units.length)
      && card.energy >= Math.max(3, actor.runes.filter(r => !r.exhausted).length / 2)) {
      category = "turn-sequence";
      alternatives = plays.filter(a => actor.hand.find(c => c.instanceId === a.cardId)?.type === "unit");
    }
  }
  if(!category && ['moveUnit','moveUnits'].includes(selected.kind)
    && game.players.some(p=>p.id!==actorId && p.base.some(c=>c.type==='unit'))){
    category='public-counterattack';
    alternatives=legal.filter(a=>['moveUnit','moveUnits','endTurn'].includes(a.kind));
  }
  if (!category && ['beginPlayCard','beginPlayChampion','endTurn','passShowdown','chooseEffectOption','chooseFirstPlayer'].includes(selected.kind)) {
    const advice=recommendPublicTacticalAction(game,actorId,enumerateAiPolicyActions(game,actorId),{selectedAction:selected});
    if(advice && actionKey(advice.action)!==actionKey(selected)) {
      category=advice.comparison==='reserve-over-commitment'?'temporary-effect-reserve':'public-tactical-comparison';
      alternatives=[advice.action];
    } else if(game.pendingChoice?.effect==='deathReplacementSource') {
      category='survival-choice';alternatives=legal.filter(a=>a.kind==='chooseEffectOption'&&a.optionId!=='decline');
    }
  }
  if (!category) return [];
  return alternatives.filter(a => actionKey(a) !== actionKey(selected)).slice(0, maximumAlternatives)
    .map(alternative => ({ category, selected, alternative, legal, hypothesisOnly: true }));
}

function auditGame(source, actorId) {
  const game = cloneGame(source);
  // The actor's deck multiset remains available for legal future draws, but
  // its logged order is not a forecast. Opponent private identities are absent.
  for (const p of game.players) {
    if (p.id === actorId) p.mainDeck.sort((a, b) => String(a.cardNumber).localeCompare(String(b.cardNumber))
      || a.instanceId.localeCompare(b.instanceId));
    else {
      const unknown = c => ({ instanceId: c.instanceId, ownerId: c.ownerId, controllerId: c.controllerId,
        type: "unknown", effects: [], keywords: [], zoneChangeCounter: c.zoneChangeCounter });
      p.mainDeck = p.mainDeck.map(unknown);
      if (!opponentPrivateInformationVisible(game, actorId, p.id)) p.hand = p.hand.map(unknown);
      for (const f of game.battlefields) for (const h of f.hidden || []) {
        if (h.ownerId === p.id && !hiddenCardIsControlledBy(h, actorId)
          && !opponentPrivateInformationVisible(game, actorId, p.id)) h.card = unknown(h.card);
      }
    }
  }
  game.log = [];
  return game;
}

export function buildLiveGameArchive(report, { model, engineFingerprint, sequences = null, maximumPositions = 32,localResourceLessons=false } = {}) {
  assert.ok(engineFingerprint, "Missing engine fingerprint.");
  const candidates = [], steps = [], actors = new Set();
  // Report descriptions, account details and UI traces never enter training.
  const sourceGameId = liveDigest({ initial: report.log?.initialState?.state,
    commands: report.log?.commands?.map(e => ({ command: e.command, actor: e.context?.actorId })) });
  const role = liveGameRole(sourceGameId);
  const { game, validation } = replaySubmittedGame(report, { model, onDecision(before, entry) {
    if (sequences && !sequences.includes(entry.sequence)) return;
    if (steps.length >= maximumPositions) return;
    const actorId = activeActorId(before);
    for (const comparison of liveGameDecisionComparisons(before, actorId, entry.command,{localResourceLessons})) {
      if (steps.length >= maximumPositions) break;
      actors.add(actorId);
      const sampledGame = auditGame(before, actorId);
      const actionSet = encodeActionSet(sampledGame, actorId, comparison.legal,
        { requiredActions: [comparison.selected, comparison.alternative] });
      const keys = actionSet.actions.map(actionKey), selectedIndex = keys.indexOf(actionKey(comparison.selected));
      assert.ok(selectedIndex >= 0 && keys.includes(actionKey(comparison.alternative)));
      const step = { actorId, state: encodeState(sampledGame, actorId), actions: actionSet.encoded,
        initialMemory: new Float32Array(NEURAL_HIDDEN_SIZE), selectedIndex, selectedActionKey: keys[selectedIndex],
        legalCount: keys.length, legalActionKeys: keys, originalLegalCount: comparison.legal.length,
        originalLegalActionKeys: comparison.legal.map(actionKey), actionManifestVersion: 2,
        source: LIVE_GAME_CONTRACT, onPolicy: false, teacherCorrectionEligible: false,
        sequence: entry.sequence, category: comparison.category };
      step.informationSetHash = createInformationSetHash(step);
      const auditKey = liveDigest([sourceGameId, entry.sequence, step.informationSetHash, actionKey(comparison.alternative)]);
      const descriptor = { version: 1, contract: "detached-leaf-audit-candidate-v1", auditKey,
        informationSetHash: step.informationSetHash, selectedAction: comparison.selected,
        recommendedAction: comparison.alternative, occupiedAuditSeeds: [], maximumSimulations: 32,
        search: { depth: 24, minimumTurnTransitions: 2 },
        // Submitted/hand-selected failures do not have a population sampling
        // probability. Keep them out of formal distributional certifications.
        samplingFrame: null,
        selectionContext: { distribution: "targeted-submitted-game", selectedPhase: before.phase,
          sourceGameId, role, category: comparison.category, commandSequence: entry.sequence } };
      candidates.push({ version: 1, auditKey, descriptor, game: sampledGame,
        gameReferences: captureGameReferences(sampledGame), actorId,
        seat: before.players.findIndex(p => p.id === actorId), deckId: before.players.find(p => p.id === actorId).deckId || "submitted-deck",
        engineFingerprint, legalActions: actionSet.actions,
        stratum: { phaseBand: before.phase }, initialMemories: {}, neuralBelief: null,
        recordedStepLocator: { actorId, stepIndex: steps.length, informationSetHash: step.informationSetHash, selectedIndex } });
      steps.push(step);
    }
  } });
  assert.ok(actors.size <= 1, "Mixed AI actors require separate reviewed curricula.");
  const actorId = [...actors][0];
  const trajectories = steps.length ? [{ gameId: `submitted:${sourceGameId}`, playerId: actorId,
    completed: true, engineFingerprint, decisionSafetyVersion: 1, decisionSafetyViolations: [],
    fixedShadowContinuation: "heuristic-only-v1", source: LIVE_GAME_CONTRACT,
    onPolicy: false, won: game.winnerId === actorId, steps }] : [];
  if (trajectories.length) assertTrainingTrajectories(trajectories, engineFingerprint);
  return { contract: LIVE_GAME_CONTRACT, version: 1, sourceGameId, role, engineFingerprint, validation,
    policyTrainingEligible: false, trajectories,
    pendingLeafAudit: { contract: "detached-leaf-audit-state-bank-v1", candidates } };
}

async function manifest(root, fingerprint) {
  const value = await optionalArchive(bankFile(root)) || { contract: LIVE_GAME_CONTRACT, engineFingerprint: fingerprint, entries: [] };
  assert.equal(value.contract, LIVE_GAME_CONTRACT);
  assert.equal(value.engineFingerprint, fingerprint, "Live-game engine changed; rebuild in a separate bank.");
  const ids = new Set();
  for (const entry of value.entries) {
    assert.equal(entry.role, liveGameRole(entry.sourceGameId), "Live-game split changed.");
    assert.ok(!ids.has(entry.sourceGameId), "Duplicated source game."); ids.add(entry.sourceGameId);
    assert.equal(path.resolve(entry.archivePath), path.join(path.resolve(root), "games", `${entry.sourceGameId}.json.gz`));
  }
  return value;
}

export async function importLiveGame(root, report, options) {
  const archive = buildLiveGameArchive(report, options);
  await mkdir(root, { recursive: true });
  return withFileLock(path.join(root, "import.lock"), async () => {
    const index = await manifest(root, options.engineFingerprint);
    const existing = index.entries.find(e => e.sourceGameId === archive.sourceGameId);
    if (existing) {
      assert.equal(existing.archiveHash, await fileHash(existing.archivePath), "Imported source changed.");
      return existing;
    }
    const archivePath = path.join(path.resolve(root), "games", `${archive.sourceGameId}.json.gz`);
    await writeTrajectoryArchive(archivePath, archive);
    const entry = { archivePath, archiveHash: await fileHash(archivePath), sourceGameId: archive.sourceGameId,
      role: archive.role, datasetKey: LIVE_GAME_CONTRACT, positions: archive.trajectories[0]?.steps.length || 0 };
    index.entries.push(entry);
    await writeTrajectoryArchive(bankFile(root), index);
    return entry;
  });
}

export async function auditLiveGames(root, { engineFingerprint, processes = 1, maximumJobs = 4, sequences = null, ...options } = {}) {
  assert.ok(Number.isInteger(processes) && processes >= 1 && processes <= 4);
  assert.ok(Number.isInteger(maximumJobs) && maximumJobs >= 1 && maximumJobs <= 32);
  return withFileLock(path.join(root, "audit.lock"), async () => {
    const index = await manifest(root, engineFingerprint), jobs = [];
    for (const entry of index.entries) {
      assert.equal(await fileHash(entry.archivePath), entry.archiveHash, "Imported source changed.");
      const prepared = await prepareDetachedLeafAuditJobs(entry, { directory: path.join(root, "audits"),
        engineFingerprint, continuationHash: "heuristic-only-v1" });
      for (const job of prepared) {
        if (sequences && !sequences.includes(job.snapshot.descriptor.selectionContext.commandSequence)) continue;
        if (await optionalArchive(path.join(job.plan.root, "evidence.json.gz"))) continue;
        jobs.push(job);
        if (jobs.length === maximumJobs) break;
      }
      if (jobs.length === maximumJobs) break;
    }
    return runDetachedLeafAuditJobs(jobs, { ...options, processes, engineFingerprint, teacherEvaluatorMode: "heuristic-only" });
  }, { timeoutMs: 1000 });
}

export async function loadLiveGameEvidence(root, engineFingerprint, { maximumTrainingGames = 8, iteration = 1 } = {}) {
  assert.ok(Number.isInteger(maximumTrainingGames) && maximumTrainingGames >= 0);
  assert.ok(Number.isInteger(iteration) && iteration >= 1);
  if (!root) return { training: [], validation: [] };
  const index = await manifest(root, engineFingerprint), result = { training: [], validation: [] };
  for (const entry of index.entries) {
    assert.equal(await fileHash(entry.archivePath), entry.archiveHash, "Imported source changed.");
    const archive = await readTrajectoryArchive(entry.archivePath);
    assert.equal(archive.contract, LIVE_GAME_CONTRACT);
    assert.equal(archive.sourceGameId, entry.sourceGameId, "Source identity changed.");
    assert.equal(archive.role, entry.role, "Source split changed.");
    assert.equal(archive.engineFingerprint, engineFingerprint, "Source fingerprint changed.");
    const jobs = await prepareDetachedLeafAuditJobs(entry, { directory: path.join(root, "audits"),
      engineFingerprint, continuationHash: "heuristic-only-v1" });
    const sidecars = [], sidecarHashes = {};
    for (const job of jobs) {
      const file = path.join(job.plan.root, "evidence.json.gz"), evidence = await optionalArchive(file);
      if (!evidence) continue;
      assert.equal(evidence.candidateId, job.plan.candidateId, "Evidence candidate changed.");
      assert.equal(evidence.sourceHash, entry.archiveHash, "Evidence source changed.");
      assert.equal(evidence.sourceGameId, job.plan.sourceGameId, "Evidence game changed.");
      assert.equal(liveDigest(evidence.locator), liveDigest(job.plan.locator), "Evidence locator changed.");
      assert.equal(liveDigest(evidence.schedule), liveDigest(job.plan.schedule), "Evidence schedule changed.");
      assert.ok(job.plan.schedule.stages.includes(evidence.completedStage), "Invalid audit stage.");
      if (!evidence.finished || !validIndependentLeafValueReference(evidence.reference)) continue;
      const comparison = evidence.reference.actionEffectComparison;
      assert.equal(comparison?.provenance?.engineFingerprint, engineFingerprint, "Reference fingerprint changed.");
      assert.equal(comparison?.provenance?.informationSetHash, job.plan.informationSetHash, "Reference state changed.");
      assert.equal(comparison?.recommendedActionKey, actionKey(job.snapshot.descriptor.recommendedAction), "Reference alternative changed.");
      assert.equal(comparison?.comparedActionKey, actionKey(job.snapshot.descriptor.selectedAction), "Reference action changed.");
      sidecars.push(file); sidecarHashes[file] = await fileHash(file);
    }
    if (sidecars.length) {
      result[entry.role].push({ ...entry, sidecars, sidecarHashes, liveGameEvidence: true, engineFingerprint });
    }
  }
  const training = result.training, count = Math.min(training.length, maximumTrainingGames);
  const start = training.length ? ((iteration - 1) * Math.max(1, count)) % training.length : 0;
  result.training = Array.from({ length: count }, (_, i) => training[(start + i) % training.length]);
  return result;
}

// Local material/tempo lessons are provisional imitation targets, never
// terminal win labels or Q certification. They need not wait for a rare
// final-win difference to appear in two continuations that both later lose.
export function liveTacticalPositionSchedule(sources,{iteration=1,maximumSamples=32}={}) {
  assert.ok(Number.isSafeInteger(iteration)&&iteration>=1,'Invalid live imitation iteration.');
  assert.ok(Number.isSafeInteger(maximumSamples)&&maximumSamples>=1,'Invalid live imitation sample limit.');
  const lists=sources.filter(s=>s.entry.role==='training').map(({entry,source})=>{
    const seen=new Set();
    return (source.pendingLeafAudit?.candidates||[]).filter(snapshot=>{
      const n=snapshot.descriptor.selectionContext.commandSequence;
      if(seen.has(n))return false;seen.add(n);return true;
    }).map(snapshot=>({entry,snapshot}));
  });
  // Interleave games, then advance the window each refresh. Previously the
  // first 32 successful positions permanently starved later reports.
  const positions=[];
  for(let i=0;i<Math.max(0,...lists.map(l=>l.length));i++)for(const list of lists)if(list[i])positions.push(list[i]);
  if(!positions.length)return [];
  const offset=((iteration-1)*maximumSamples)%positions.length;
  return [...positions.slice(offset),...positions.slice(0,offset)];
}

export async function collectLiveTacticalDemonstrations(root, fingerprint, model, {maximumSamples=32,iteration=1,localResourceLessons=false,responseContext=null}={}) {
  if(!root)return {samples:[],sourceGames:[],contract:'live-tactical-imitation-v1'};
  const index=await manifest(root,fingerprint),samples=[],sourceGames=[],sources=[];
  const {createNeuralSession}=await import('../src/ai/neural/model.mjs');
  for(const entry of index.entries.filter(e=>e.role==='training')){
    assert.equal(liveGameRole(entry.sourceGameId),'training');
    assert.equal(await fileHash(entry.archivePath),entry.archiveHash,'Live imitation source changed.');
    const source=await readTrajectoryArchive(entry.archivePath);
    assert.equal(source.engineFingerprint,fingerprint);
    assert.equal(source.sourceGameId,entry.sourceGameId,'Live imitation identity changed.');
    assert.equal(source.role,entry.role,'Live imitation role changed.');
    sources.push({entry,source});
  }
  let reviewedPositions=0;
  for(const {entry,snapshot} of liveTacticalPositionSchedule(sources,{iteration,maximumSamples})){
      if(samples.length>=maximumSamples)break;
      reviewedPositions++;
      const game=restoreGameReferences(structuredClone(snapshot.game),snapshot.gameReferences);
      const actorId=snapshot.actorId,legal=enumerateAiPolicyActions(game,actorId);
      const decision=createNeuralSession(model).decide(game,actorId,legal,{greedy:true});
      const advice=(localResourceLessons&&recommendLocalResourceDemonstration(game,actorId,decision))
        ||recommendTacticalDemonstration(game,actorId,decision,{responseContext});
      if(!advice)continue;
      const selectedIndex=decision.legalActions.findIndex(a=>actionKey(a)===actionKey(advice.action));
      if(selectedIndex<0)continue;
      samples.push({gameId:`live-tactical:${entry.sourceGameId}`,playerId:actorId,imitation:true,
        contract:'live-tactical-imitation-v1',engineFingerprint:fingerprint,steps:[{
          state:decision.stateEncoding,actions:decision.actionEncoding.slice(0,decision.legalCount*ACTION_DIM),
          initialMemory:decision.initialMemory,selectedIndex,legalCount:decision.legalCount,
          oldLogProbability:0,behaviorTemperature:1,advantage:Math.min(0.5,advice.weight),return:0,value:0,
          beliefTarget:new Float32Array(CARD_BINS),imitation:true,winProbabilityLabel:false,
          teacherCorrectionEligible:false,sourceGameId:entry.sourceGameId,
          ...(advice.localResourceLesson?{localResourceLesson:true,localResourceReason:advice.comparison}:{}),
          ...(advice.responsePolicyLesson?{responsePolicyLesson:true,responsePolicyReview:advice.responseReview}:{}),
          ...(advice.mulliganLesson?{mulliganLesson:true}:{}),
          ...(advice.growthLesson?{growthLesson:true,developmentHorizon:advice.developmentHorizon}:{}),
          selectedActionKey:actionKey(advice.action),legalActionKeys:decision.legalActions.map(actionKey),
          category:snapshot.descriptor.selectionContext.category,
          tacticalComparison:advice.comparison||advice.responseReview?.probabilityModel,
          opponentResponsesCompared:Boolean(advice.opponentResponsesCompared),
          commandSequence:snapshot.descriptor.selectionContext.commandSequence}]});
      if(!sourceGames.some(s=>s.sourceGameId===entry.sourceGameId))
        sourceGames.push({sourceGameId:entry.sourceGameId,archiveHash:entry.archiveHash});
  }
  return {samples,sourceGames,iteration,reviewedPositions,contract:'live-tactical-imitation-v1'};
}

export async function assertLiveGameEvidence(entry, expectedRole, fingerprint) {
  assert.equal(entry.role, expectedRole, "Held-out live game reached training.");
  assert.equal(entry.role, liveGameRole(entry.sourceGameId), "Live-game split changed.");
  assert.equal(entry.engineFingerprint, fingerprint, "Live-game fingerprint changed.");
  assert.equal(await fileHash(entry.archivePath), entry.archiveHash, "Imported source changed.");
  assert.ok(entry.sidecars?.length, "Live game has no audited evidence.");
  for (const file of entry.sidecars) assert.equal(await fileHash(file), entry.sidecarHashes[file], "Committed evidence changed.");
}

export function assessLiveGameChoice(comparison, chosenAction) {
  const { lowerBound: lower, upperBound: upper } = comparison?.pairedAudit || {};
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper
    || !(lower > 0 || upper < 0)) return "unmeasured";
  const chosen = actionKey(chosenAction);
  if (![comparison.recommendedActionKey, comparison.comparedActionKey].includes(chosen)) return "unmeasured";
  return (chosen === comparison.recommendedActionKey) === (lower > 0) ? "better" : "worse";
}

// Uncompared choices are 'unmeasured', not successes. Only held-out terminal
// comparisons can count as a regression outcome; no-response previews cannot.
export async function evaluateLiveGameRegressions(root, fingerprint, selectAction, { entries } = {}) {
  const validation = entries ?? (await loadLiveGameEvidence(root, fingerprint)).validation;
  const categories = {}, games = new Set();
  for (const entry of validation) {
    await assertLiveGameEvidence(entry, "validation", fingerprint);
    const archive = await readTrajectoryArchive(entry.archivePath);
    for (const file of entry.sidecars) {
      const evidence = await readTrajectoryArchive(file);
      const snapshot = archive.pendingLeafAudit.candidates.find(c => c.recordedStepLocator.stepIndex === evidence.locator.stepIndex);
      const step = archive.trajectories[0].steps[evidence.locator.stepIndex];
      const count = categories[step.category] ||= { comparisons: 0, better: 0, worse: 0, unmeasured: 0 };
      count.comparisons++; games.add(entry.sourceGameId);
      restoreGameReferences(snapshot.game, snapshot.gameReferences);
      const chosen = await selectAction(snapshot.game, snapshot.actorId, snapshot.legalActions);
      count[assessLiveGameChoice(evidence.reference.actionEffectComparison, chosen)]++;
    }
  }
  return { contract: LIVE_GAME_CONTRACT, scope: "held-out-game-cold-start-diagnostic", independentGames: games.size,
    categories, promotionEligible: false, status: games.size ? "diagnostic-only" : "unavailable-no-held-out-audits" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(args[i]?.startsWith("--") && args[i + 1], "Options require explicit values.");
    opts[args[i].slice(2)] = args[i + 1];
  }
  assert.ok(opts.directory, "Specify --directory for an isolated curriculum bank.");
  const engineFingerprint = computeEngineFingerprint();
  if (command === "import") {
    assert.ok(opts.report && opts["payment-model"], "Specify --report and --payment-model.");
    const report = JSON.parse(await readFile(opts.report, "utf8"));
    const model = createModel(JSON.parse(await readFile(opts["payment-model"], "utf8")));
    console.log(JSON.stringify(await importLiveGame(opts.directory, report, { model, engineFingerprint,
      sequences: opts.sequences ? opts.sequences.split(",").map(Number) : null }), null, 2));
  } else if (command === "audit") {
    const outputs = await auditLiveGames(opts.directory, { engineFingerprint,
      processes: Number(opts.processes || 1), maximumJobs: Number(opts["maximum-jobs"] || 4),
      sequences: opts.sequences ? opts.sequences.split(",").map(Number) : null,
      onProgress: value => { if (value.completedStage) console.log(JSON.stringify({ candidateId: value.candidateId, stage: value.completedStage, outcome: value.outcome })); } });
    console.log(JSON.stringify({ completed: outputs.filter(o => o.finished).length, ready: await loadLiveGameEvidence(opts.directory, engineFingerprint) }));
  } else if (command === "status") console.log(JSON.stringify(await loadLiveGameEvidence(opts.directory, engineFingerprint), null, 2));
  else throw new Error("Use import, audit or status.");
}

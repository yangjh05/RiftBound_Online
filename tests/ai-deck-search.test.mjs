import test from "node:test";
import assert from "node:assert/strict";
import { cards, decklists } from "../src/cards.mjs";
import { isCardBanned } from "../src/decks/legality.mjs";
import { resolveTrainingDecks } from "../src/ai/training-decks.mjs";
import { mutateCardPackage } from "../src/ai/deckbuilding.mjs";
import { repairTrainingDeck, validateTrainingDeck, trainingDeckKey, mutateLegalTrainingDeck } from "../src/ai/legal-decks.mjs";
import { createDeckSearchProtocol, createDeckSearchPlan, deckSearchTaskOptions,
  expectedDeckSearchPair, assertDeckSearchGame, learnDeckSearch, deckSearchScore,
  commitDeckSearchProtocol, primaryDeckSearchAnchors } from "../scripts/adaptive-deck-search.mjs";
import { boundedMatchPlan, assertFrozenMatchPlan } from "../scripts/adaptive-policy-q-contract.mjs";
import { seededRandom, scheduledTrainingDeckPair, selfPlayComparisonSchedule } from "../src/ai/neural/selfplay.mjs";
import { selfPlayTaskOptions } from "../scripts/ai-selfplay-task-options.mjs";
import { collectProcessPoolSelfPlay } from "../scripts/ai-selfplay-process-pool.mjs";
import { createNeuralModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import {createGame} from '../src/engine.mjs';

const seeds = resolveTrainingDecks(decklists, "origins-era");
const protocol = createDeckSearchProtocol(seeds, 0);

test('the authored non-Aurora Yi anchor exactly preserves the submitted 40-card list and chosen champion',()=>{
  const deck=protocol.anchors.find(deck=>deck.authoredPreset?.file==='master-yi-no-aurora-20260924.json');
  assert.ok(deck);assert.deepEqual(deck.seedRepair,[]);
  const counts=Object.fromEntries([...new Set(deck.main.map(c=>c.name))].map(name=>[name,deck.main.filter(c=>c.name===name).length]));
  assert.deepEqual(counts,{'Master Yi, Honed':1,'En Garde':2,Charm:3,Defy:3,Sabotage:3,'Clockwork Keeper':3,
    Confront:1,Discipline:3,'Pit Rookie':3,'Stalwart Poro':3,"Zhonya's Hourglass":2,'Find Your Center':2,
    'First Mate':2,'Qiyana, Victorious':3,'Deadbloom Predator':3,'Whiteflame Protector':3});
  assert.deepEqual(deck.battlefields.map(c=>c.name),['Grove of the God-Willow',"Targon's Peak","Vilemaw's Lair"]);
  assert.equal(deck.runes.filter(c=>c.domain==='Calm').length,6);
  assert.equal(deck.runes.filter(c=>c.domain==='Body').length,6);
  assert.equal(deck.sideboard.length,0);
  const game=createGame({decks:[deck,deck],firstPlayerId:'p1',randomSeed:123,interactive:true});
  for(const player of game.players)assert.deepEqual(player.availableChampions.map(c=>c.name),['Master Yi, Honed']);
  assert.ok(!protocol.anchors.some(deck=>deck.evolution?.rootId==='keenan-xiong'));
  const plan=newPlan(2);
  assert.ok(plan.deckSearch.assignments.some(a=>a.mode==='anchor'&&a.testedDeckId===deck.id));
});
test("six search anchors preserve the five-legend bounded promotion budget", () => {
  assert.equal(protocol.anchors.length, 6);
  const representatives = primaryDeckSearchAnchors(protocol, seeds);
  assert.equal(representatives.length, 5);
  for (const purpose of ["champion-promotion", "tactical-baseline-progress"]) {
    const plan = boundedMatchPlan({ candidateHash: "candidate", opponentHash: "opponent", ordinal: 53,
      deckIds: representatives.map(deck => deck.id), randomSeed: 909939566, purpose });
    assertFrozenMatchPlan(plan);
    assert.equal(plan.blocks * 8, purpose === "champion-promotion" ? 2400 : 800);
  }
  assert.throws(() => primaryDeckSearchAnchors({ ...protocol, anchors: protocol.anchors.slice(1) }, seeds), /missing/);
});
test('both distinct Yi anchors receive training blocks across the fixed curriculum rotation',()=>{
  const yi=protocol.anchors.filter(d=>d.legend.name==='Master Yi, Wuju Bladesman');
  assert.equal(yi.length,2);
  assert.deepEqual(yi.map(d=>d.main.filter(c=>c.name==='Dazzling Aurora').length).sort(),[0,3]);
  const appearances=new Map(yi.map(d=>[d.id,0]));
  for(let iteration=1;iteration<=10;iteration++){
    const plan=createDeckSearchPlan(protocol,undefined,{iteration,games:32,seed:100+iteration,sourceBehaviorHash:'test'});
    for(const assignment of plan.assignments)if(assignment.mode==='anchor'&&appearances.has(assignment.testedDeckId)){
      appearances.set(assignment.testedDeckId,appearances.get(assignment.testedDeckId)+1);
    }
  }
  assert.ok([...appearances.values()].every(n=>n>=16));
});
const newPlan = (iteration = 1, state) => {
  const plan = { iteration, games: 32, seed: 717 + iteration, sourceBehaviorHash: "frozen-policy",
    utility: { validationGameIndexes: [1, 9, 17, 25] } };
  plan.deckSearch = createDeckSearchPlan(protocol, state, plan);
  return plan;
};
function fakeResults(plan) {
  return plan.deckSearch.assignments.map((_, index) => {
    const pair = expectedDeckSearchPair(plan.deckSearch, index, plan.seed);
    return { summary: { completed: true, winnerId: "p1", firstPlayerId: selfPlayComparisonSchedule(index).firstPlayerId,
      deckIds: pair.map(deck => deck.id) }, deckSearchConfigurationKeys: pair.map(trainingDeckKey),
    trajectories: pair.map((deck, seat) => ({ playerId: `p${seat + 1}`, deckId: deck.id })) };
  });
}

test("Origins seed lists become strictly legal without mutating originals", () => {
  const original = JSON.stringify(decklists);
  for (const deck of Object.values(decklists).filter(deck => ["Origins", "Proving Grounds"].includes(deck.legend.set))) {
    const repaired = repairTrainingDeck(deck);
    assert.equal(validateTrainingDeck(repaired).playable, true, deck.id);
    assert.equal(repaired.legend.cardNumber, deck.legend.cardNumber);
    assert.equal(repaired.main.length, 40);
    assert.ok(![...repaired.main, ...repaired.sideboard, ...repaired.battlefields].some(isCardBanned));
  }
  assert.equal(JSON.stringify(decklists), original);
  assert.equal(protocol.anchors.length, 6);
  const yi = protocol.anchors.filter(deck => deck.legend.name.startsWith("Master Yi"));
  assert.ok(yi.some(deck => deck.main.some(card => card.name === "Dazzling Aurora")));
  assert.ok(yi.some(deck => !deck.main.some(card => card.name === "Dazzling Aurora")));
});

test("canonical legality rejects banned default lists, out-of-pool cards and alternate-printing copy overflow", () => {
  assert.equal(validateTrainingDeck(seeds.find(deck => deck.id === "proving-grounds-annie")).playable, false);
  assert.equal(validateTrainingDeck(protocol.anchors[0], "unknown").playable, false);
  const deck = structuredClone(Object.values(decklists).find(deck => deck.id === "origins-kaisa"));
  const alternate = Object.values(cards).find(card => card.name === "Kai'Sa, Survivor" && !deck.main.some(c => c.cardNumber === card.cardNumber));
  assert.ok(alternate);
  deck.sideboard = [alternate, alternate, alternate];
  assert.equal(validateTrainingDeck(deck).playable, false);
  const corrupted = structuredClone(protocol.anchors[0]);
  corrupted.main.pop();
  assert.throws(() => repairTrainingDeck(corrupted), /Invalid seed/);
});

test("mutation is reproducible and legal across all zones and never escapes Origins", () => {
  const random = seededRandom(573);
  const seenSets = new Set();
  for (const seed of protocol.anchors) {
    let deck = seed;
    for (const kind of ["cardPackage", "runes", "battlefields", "sideboard"]) {
      deck = mutateLegalTrainingDeck(deck, {}, random, { kind, packageSize: 8, broad: true });
      assert.equal(validateTrainingDeck(deck).playable, true);
      for (const card of deck.main) seenSets.add(card.set);
      assert.equal(deck.legend.cardNumber, seed.legend.cardNumber);
    }
  }
  assert.ok([...seenSets].every(set => ["Origins", "Proving Grounds"].includes(set)));
  const a = mutateCardPackage(seeds[0], {}, seededRandom(22), 3);
  const b = mutateCardPackage(seeds[0], {}, seededRandom(22), 3);
  assert.deepEqual(a, b);
  const reversed = structuredClone(a); reversed.main.reverse(); reversed.runes.reverse();
  assert.equal(trainingDeckKey(a), trainingDeckKey(reversed));
});

test("frozen search schedule preserves mixture, both Yi anchors, and seat/first-player coverage", () => {
  const seenAnchors = new Set();
  const modes = { anchor: 0, local: 0, broad: 0 };
  for (let iteration = 1; iteration <= 10; iteration++) {
    const plan = newPlan(iteration);
    assert.deepEqual(plan, newPlan(iteration));
    for (let block = 0; block < 4; block++) {
      const item = plan.deckSearch.assignments[block * 8];
      modes[item.mode]++;
      if (item.mode === "anchor") seenAnchors.add(item.testedDeckId);
      const cells = new Set();
      for (let index = block * 8; index < block * 8 + 8; index++) {
        const task = selfPlayTaskOptions({}, { seed: plan.seed, gameIndex: index,
          optionOverrides: deckSearchTaskOptions(plan.deckSearch, index) });
        const pair = scheduledTrainingDeckPair(task.decks, selfPlayComparisonSchedule(index).comparisonBlock,
          plan.seed, { mirrorFraction: task.mirrorFraction, deckSeatScheduleVersion: task.deckSeatScheduleVersion }).decks;
        assert.deepEqual(pair.map(d => d.id), expectedDeckSearchPair(plan.deckSearch, index, plan.seed).map(d => d.id));
        cells.add(`${pair.findIndex(d => d.id === item.testedDeckId)}:${selfPlayComparisonSchedule(index).firstPlayerId}`);
      }
      assert.equal(cells.size, new Set(item.pairIds).size === 1 ? 2 : 4);
    }
  }
  assert.deepEqual(modes, { anchor: 20, local: 10, broad: 10 });
  for (const anchor of protocol.anchors) assert.ok(seenAnchors.has(anchor.id));
});

test("held-out winners never affect deck learning; frozen decks and source state are checked", () => {
  const plan = newPlan();
  const results = fakeResults(plan);
  const first = learnDeckSearch(undefined, plan, results);
  for (const index of plan.utility.validationGameIndexes) results[index].summary.winnerId = "p2";
  assert.deepEqual(learnDeckSearch(undefined, plan, results), first);
  assert.throws(() => learnDeckSearch(first, plan, results), /input changed/);
  const corrupted = structuredClone(results[0]); corrupted.deckSearchConfigurationKeys[0] = "changed";
  assert.throws(() => assertDeckSearchGame(corrupted, plan, 0), /contents changed/);
  const old = structuredClone(results[0]); old.summary.deckIds[0] = "old-deck";
  assert.throws(() => assertDeckSearchGame(old, plan, 0), /frozen assignment/);
  const assignment = deckSearchTaskOptions(plan.deckSearch, 0);
  assignment.deckSearchAssignment.poolId = "vendetta-era";
  assert.throws(() => selfPlayTaskOptions({}, { optionOverrides: assignment }), /Invalid frozen deck/);
  const next = newPlan(2, first);
  assert.deepEqual(next, newPlan(2, structuredClone(first)));
});

test("sparse outcomes are shrunk and protocol changes cannot rewrite an active search", () => {
  const score = deckSearchScore({ games: 1, opponents: { a: { games: 1, wins: 1 } } }, ["a", "b"]);
  assert.ok(score.winRate < 0.53);
  assert.equal(score.certified, false);
  assert.equal(score.opponentsSeen, 1);
  const skewed = deckSearchScore({ games: 100, opponents: { a: { games: 100, wins: 100,
    conditions: { "0:p1": { games: 100, wins: 100 } } } } }, ["a"]);
  assert.ok(skewed.winRate < 0.63, "One easy seat/first-player condition cannot dominate the score.");
  const state = { iteration: 0 };
  commitDeckSearchProtocol(state, protocol);
  assert.throws(() => commitDeckSearchProtocol(state, null), /protocol changed/);
  assert.throws(() => commitDeckSearchProtocol({ iteration: 2 }, protocol), /prospectively/);
  assert.equal(createDeckSearchPlan({ ...protocol, afterIteration: 9 }, undefined, { iteration: 9 }), null);
});

test("real process workers use frozen legal configurations and preserve their identities", async () => {
  const model = createNeuralModel();
  const plan = newPlan();
  plan.deckSearch.assignments[0].pairIds = [...plan.deckSearch.assignments[8].pairIds];
  try {
    await collectProcessPoolSelfPlay({ model, decks: seeds, games: 1, seed: plan.seed,
      processes: 1, workers: 1, maxActions: 8, teacherFraction: 0, teacherBudget: 0,
      teacherLeafAuditSimulations: 0, bestOfThreeFraction: 0, retainResults: false,
      resolveTaskOptions: ({ task }) => ({ optionOverrides: {
        ...deckSearchTaskOptions(plan.deckSearch, task.gameIndex), deterministicGameRandomness: true } }),
      onGameComplete: ({ result, gameIndex }) => assertDeckSearchGame(result, plan, gameIndex) });
  } finally { disposeNeuralModel(model); }
});

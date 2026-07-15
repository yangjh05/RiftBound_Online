import { cards } from "../src/cards.mjs";
import {
  chooseEffectOption, confirmFirstPlayer, createGame, moveUnit, passShowdown,
  selectBattlefield, selectChampion, skipMulligan
} from "../src/engine.mjs";
import { captureInteractionState, causalInteractionCoverageKeys, validateSemanticChoice, validateStableGameState } from "./semantic-oracle.mjs";
import { assertRuleState, assertRuleTransition, captureRuleState } from "./rules-oracle.mjs";

const movers = uniqueByBehavior(Object.values(cards).filter((card) => card.type === "unit" && card.effects?.some((effect) => effect.timing === "onMove")));
const payloads = [cards.lonelyPoro, cards.confront, cards.trinityForce, cards.scrapheap].filter(Boolean);
const destinationModes = ["enemy", "empty-opponent-controlled"];
const observerModes = [false, true];
const sourceEffectModes = [false, true];
const coverage = new Set();
let scenarios = 0;

for (const moverCard of movers) {
  for (const payloadCard of payloads) {
    for (const destinationMode of destinationModes) {
      for (const withObserver of observerModes) {
        for (const withSourceEffect of sourceEffectModes) {
          try {
            runScenario({ moverCard, payloadCard, destinationMode, withObserver, withSourceEffect });
          } catch (error) {
            error.message = `${moverCard.name} × ${payloadCard.name} × ${destinationMode} × observer=${withObserver} × sourceEffect=${withSourceEffect}: ${error.message}`;
            throw error;
          }
          scenarios += 1;
        }
      }
    }
  }
}

const transitions = [...coverage].filter((key) => key.startsWith("cause|")).length;
const contexts = [...coverage].filter((key) => key.startsWith("interaction|")).length;
console.log(`Passed ${scenarios} synthesized interaction scenarios across ${movers.length} on-move cards and ${payloads.length} payloads; observed ${transitions} action-to-state transitions in ${contexts} active-effect contexts.`);

function runScenario({ moverCard, payloadCard, destinationMode, withObserver, withSourceEffect }) {
  const game = createGame({ interactive: true, manualActionChainPriority: false });
  finishSetup(game);
  const player = game.players.find((candidate) => candidate.id === game.currentPlayerId);
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const mover = makeInstance(moverCard, player.id, `synth-mover-${scenarios}`);
  mover.keywords = [...new Set([...(mover.keywords || []), "Ganking"] )];
  const payload = makeInstance(payloadCard, player.id, `synth-payload-${scenarios}`);
  const exhaustedAlly = makeInstance(cards.lonelyPoro, player.id, `synth-exhausted-${scenarios}`);
  exhaustedAlly.exhausted = true;
  const companion = makeInstance(cards.lonelyPoro, player.id, `synth-companion-${scenarios}`);
  const defender = makeInstance(cards.lonelyPoro, opponent.id, `synth-defender-${scenarios}`);
  const observer = makeInstance(cards.volibearImposing || cards.volibearImposing2, opponent.id, `synth-observer-${scenarios}`);
  const source = game.battlefields[0];
  const destination = game.battlefields[1];
  const observerField = game.battlefields[2];
  const needsCompanion = moverCard.name === "Stealthy Pursuer";
  source.units = [mover, ...(needsCompanion ? [companion] : [])];
  source.controlledBy = player.id;
  if (withSourceEffect && cards.backAlleyBar) source.effects = structuredClone(cards.backAlleyBar.effects || []);
  destination.units = destinationMode === "enemy" ? [defender] : [];
  destination.controlledBy = opponent.id;
  if (withObserver && observer && observerField) {
    observerField.units = [observer];
    observerField.controlledBy = opponent.id;
  }
  player.hand = [payload];
  player.base = [exhaustedAlly];
  player.mainDeck = Array.from({ length: 12 }, (_, index) =>
    makeInstance(index % 2 ? cards.confront : cards.lonelyPoro, player.id, `synth-draw-${scenarios}-${index}`));

  const interactionBefore = captureInteractionState(game);
  const rulesBefore = captureRuleState(game);
  const result = moveUnit(game, mover.instanceId, destination.instanceId);
  if (!result.ok) fail("move was rejected");
  assertRuleTransition(rulesBefore, game, { kind: "standardMove", unitIds: [mover.instanceId], ok: true });
  settle(game);
  for (const key of causalInteractionCoverageKeys(interactionBefore, game, "move-and-settle")) coverage.add(key);
  validateStableGameState(game);
  assertRuleState(game, { action: "synthesized movement settled" });
  const operation = (game.operations || []).find((candidate) => candidate.data?.unitIds?.includes(mover.instanceId));
  if (!operation || operation.status !== "completed") fail(`move operation did not complete (${operation?.status || "missing"})`);
  if (game.phase !== "showdown" || game.showdown?.battlefieldId !== destination.instanceId) {
    fail(`destination showdown did not begin (phase=${game.phase}, showdown=${game.showdown?.battlefieldId || "none"}, staged=${game.stagedEvents?.length || 0}, pending=${game.pendingChoice?.effect || "none"}, units=${destination.units.map((unit) => unit.name).join("/")}, control=${destination.controlledBy}, winner=${game.winnerId || "none"}, log=${game.log.slice(-6).join(" | ")})`);
  }
  if (destinationMode === "enemy" && game.showdown.combat !== true) fail("enemy destination did not begin combat");
  if (destinationMode !== "enemy" && game.showdown.combat !== false) fail("empty opposing destination did not begin a non-combat showdown");

  function fail(message) {
    throw new Error(`${moverCard.name} × ${payloadCard.name} × ${destinationMode} × observer=${withObserver} × sourceEffect=${withSourceEffect}: ${message}`);
  }
}

function settle(game) {
  let safety = 0;
  while (safety < 100) {
    safety += 1;
    validateStableGameState(game);
    if (game.phase === "showdown") return;
    if (game.pendingChoice) {
      validateSemanticChoice(game, game.pendingChoice);
      const option = game.pendingChoice.options.find((candidate) => !["decline", "done", "skip"].includes(candidate.id)) || game.pendingChoice.options[0];
      const result = chooseEffectOption(game, option.id ?? option.value);
      if (!result.ok) throw new Error(`choice ${option.id} failed`);
      continue;
    }
    if (game.actionChain) {
      passShowdown(game, game.actionChain.priorityPlayerId);
      continue;
    }
    if (game.pendingPayment) throw new Error("synthesized movement unexpectedly requested payment");
    break;
  }
  if (safety >= 100) throw new Error("interaction scenario did not settle");
}

function finishSetup(game) {
  confirmFirstPlayer(game);
  while (game.phase === "champion-select") {
    const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
    selectChampion(game, player.id, player.availableChampions[0].instanceId);
  }
  while (game.phase === "battlefield-select") {
    const player = game.players.find((candidate) => candidate.id === game.setupPlayerId);
    selectBattlefield(game, player.id, player.availableBattlefields[0].instanceId);
  }
  while (game.phase === "mulligan") skipMulligan(game);
}

function makeInstance(card, ownerId, instanceId) {
  return { ...structuredClone(card), instanceId, ownerId, controllerId: ownerId, exhausted: false, damage: 0, stunned: false, buffs: 0, attachments: [] };
}

function uniqueByBehavior(items) {
  const signatures = new Set();
  return items.filter((item) => {
    const signature = `${item.name}|${JSON.stringify(item.effects?.filter((effect) => effect.timing === "onMove") || [])}`;
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    return true;
  });
}

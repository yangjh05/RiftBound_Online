import { cards } from "../src/cards.mjs";
import { effectDefinition, effectKey } from "../src/effects/registry.mjs";
import { KEYWORD_BEHAVIOR_EFFECT_SPECS, keywordBehaviorEffectSpecs } from "../src/rules/keywords.mjs";

const ACTUAL_BUFF_KINDS = new Set([
  "anotherUnitBuffSelf", "buffAnotherFriendlyOnBuffedUnitDeath", "buffFriendlyUnit",
  "buffSelf", "buffSelfDrawIfControlTag", "buffUnit", "buffUnitHere",
  "showstopper", "spendBuffsReadyThenBuffFriendlyUnits", "spendFriendlyBuffBuffSelfReady",
  "standUnited"
]);

export const EFFECT_RULE_FAMILIES = Object.freeze([
  family("card-text-execution", ["002", "051", "055"], () => true, "baseline"),
  family("card-play-process", ["349", "354", "355", "359", "419"], (effect) => ["spell", "onPlay"].includes(effect.timing), "timing"),
  family("activated-ability", ["376", "377", "380", "381"], (effect) => effect.timing === "activated", "timing"),
  family("triggered-ability", ["382", "383", "388"], (effect) => !["spell", "onPlay", "activated", "static", "levelStatic", "combatStatic", "replacement"].includes(effect.timing), "timing"),
  family("passive-ability", ["363", "365", "366"], (effect) => ["static", "levelStatic", "combatStatic", "battlefieldControl"].includes(effect.timing), "timing"),
  family("replacement-effect", ["367", "369", "438"], (effect) => effect.timing === "replacement" || /save|replace/i.test(effect.kind), "timing"),
  family("replace-action", ["438"], kindMatches(/save|replace/i)),
  family("choices", ["355", "402"], (effect) => {
    const definition = effectDefinition(effect);
    return Boolean(definition?.targetProvider || definition?.declaration || effect.target || effect.optional);
  }),
  family("costs-and-payment", ["356", "357", "358", "403", "404", "405"], (effect) => /cost|pay|spend|reduction|ignore/i.test(effect.kind)
    || Boolean(effect.additionalPower || effect.costEnergy || effect.costRecycleTrash || effect.spendBuff || effect.exhaustSelf)),
  family("draw", ["413"], kindMatches(/draw/i)),
  family("exhaust", ["414"], kindMatches(/exhaust/i)),
  family("ready", ["415"], kindMatches(/ready/i)),
  family("recycle", ["416"], kindMatches(/recycle/i)),
  family("deal-damage", ["417", "142", "143.2.a", "323.5"], kindMatches(/damage/i)),
  family("heal", ["418"], kindMatches(/heal/i)),
  family("play", ["419"], kindMatches(/play|recruit/i)),
  family("move", ["420", "440", "448"], kindMatches(/move/i)),
  family("hide", ["421", "811"], kindMatches(/hide|hidden/i)),
  family("discard", ["422"], kindMatches(/discard/i)),
  family("stun", ["423"], kindMatches(/stun/i)),
  family("reveal", ["424", "128"], kindMatches(/reveal|looked|topDeck|topReveal/i)),
  family("counter", ["425"], kindMatches(/counter|sabotage/i)),
  family("buff", ["426", "702.2", "702.3"], (effect) => ACTUAL_BUFF_KINDS.has(effect.kind)),
  family("banish", ["427"], kindMatches(/banish/i)),
  family("kill", ["428", "323.4", "323.5"], kindMatches(/kill|trashGear/i)),
  family("add-resource", ["429", "164"], kindMatches(/addEnergy|resource/i)),
  family("channel", ["430"], kindMatches(/channel/i)),
  family("double", ["432"], kindMatches(/double/i)),
  family("swap", ["433"], kindMatches(/swap/i)),
  family("attachment", ["434", "716", "718.5.d", "719.3.a"], kindMatches(/attach|equip/i)),
  family("predict", ["436"], kindMatches(/predict/i)),
  family("prevent", ["437"], kindMatches(/prevent|cant|cannot/i)),
  family("create-token", ["439", "180", "182.1.d", "183"], kindMatches(/token|recruit/i)),
  family("recall", ["449", "450", "451"], kindMatches(/return.*Base|recall/i)),
  family("zone-change", ["110", "416.1.c"], kindMatches(/return.*Hand|returnTrash|returnHidden|possession|steal/i)),
  family("scoring", ["462", "464", "465", "466", "467"], (effect) => /score|conquer|hold|gainPoint|victory/i.test(`${effect.timing}:${effect.kind}`)),
  family("might-and-layers", ["137.1", "468", "472", "709", "710"], (effect) => /might/i.test(effect.kind)
    || (Number.isFinite(effect.amount) && !ACTUAL_BUFF_KINDS.has(effect.kind) && !/draw|damage|channel|ready|recycle|energy|point|xp/i.test(effect.kind))),
  family("keywords", ["721"], kindMatches(/keyword|shield|deflect|assault|ganking|tank|temporary/i)),
  family("runes-and-power", ["164", "430"], kindMatches(/rune|power/i)),
  family("control", ["188", "187.6"], kindMatches(/control|possession|steal/i)),
  family("temporary-expiration", ["317.2.c"], (effect) => effect.temporary === true || /temporary|thisTurn/i.test(effect.kind)),
  family("combat", ["454", "458", "460", "461"], (effect) => ["attackOrDefend", "defendHere", "combatStatic"].includes(effect.timing) || /duel|alphaStrike|stormbringer|facebreaker|lastBreath|zenithBlade/i.test(effect.kind)),
  family("battlefield-flow", ["187", "319.8", "341", "344"], (effect) => /battlefield|showdown/i.test(`${effect.timing}:${effect.kind}`)),
  family("xp", ["728", "729", "730"], (effect) => /xp/i.test(effect.kind) || Number.isFinite(effect.xp)),
  family("copy-and-linked-effects", ["393", "395", "397"], kindMatches(/copy/i)),
  family("named-mass-kill", ["355", "428"], (effect) => effect.kind === "divineJudgment"),
  family("extra-turn-queue", ["317.3"], (effect) => effect.kind === "extraTurn"),
  family("named-group-choice-draw", ["355", "413"], (effect) => effect.kind === "partyFavors"),
  family("trigger-multiplicity", ["382", "383", "393"], (effect) => effect.kind === "deathTriggersAdditionalTime"),
  family("movement-destination-restriction", ["420", "449", "451"], (effect) => effect.kind === "opponentsUnitsOnlyToBase")
]);

export function buildEffectRuleMap(cardPool = Object.values(cards)) {
  const effectsByKey = new Map();
  for (const card of cardPool) {
    for (const effect of [...(card.effects || []), ...keywordBehaviorEffectSpecs(card)]) {
      const key = effectKey(effect);
      if (!effectsByKey.has(key)) effectsByKey.set(key, []);
      effectsByKey.get(key).push({ cardNumber: card.cardNumber, cardName: card.name, effect });
    }
  }
  for (const definition of KEYWORD_BEHAVIOR_EFFECT_SPECS) {
    const { keyword, repeatable, numeric, ...effect } = definition;
    const key = effectKey(effect);
    if (!effectsByKey.has(key)) effectsByKey.set(key, []);
    if (!effectsByKey.get(key).length) {
      effectsByKey.get(key).push({ cardNumber: `RULE-${keyword}`, cardName: `[${keyword}]`, effect });
    }
  }
  return [...effectsByKey.entries()]
    .map(([key, uses]) => {
      const representative = uses[0].effect;
      const families = EFFECT_RULE_FAMILIES.filter((entry) => entry.matches(representative));
      const specialized = families.filter((entry) => entry.classification !== "baseline");
      return {
        effectKey: key,
        cards: uses.length,
        examples: uses.slice(0, 3).map(({ cardNumber, cardName }) => ({ cardNumber, cardName })),
        families: families.map((entry) => entry.id),
        officialRuleIds: [...new Set(families.flatMap((entry) => entry.ruleIds))],
        hasTimingFamily: specialized.some((entry) => entry.classification === "timing"),
        hasSemanticFamily: specialized.some((entry) => entry.classification === "semantic")
      };
    })
    .sort((left, right) => left.effectKey.localeCompare(right.effectKey));
}

export function validateEffectRuleMap(entries, catalog) {
  const errors = [];
  const catalogIds = new Set((catalog?.clauses || []).map((clause) => clause.id));
  const duplicateKeys = entries.map((entry) => entry.effectKey).filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length) errors.push(`duplicate effect mappings: ${[...new Set(duplicateKeys)].join(", ")}`);
  for (const entry of entries) {
    if (!entry.hasTimingFamily) errors.push(`${entry.effectKey} has no official timing/ability family`);
    if (!entry.hasSemanticFamily) errors.push(`${entry.effectKey} has no specialized official action/state family`);
    for (const ruleId of entry.officialRuleIds) if (!catalogIds.has(ruleId)) errors.push(`${entry.effectKey} maps to missing official rule ${ruleId}`);
  }
  return errors;
}

function family(id, ruleIds, matches, classification = "semantic") {
  return Object.freeze({ id, ruleIds: Object.freeze(ruleIds), matches, classification });
}

function kindMatches(pattern) {
  return (effect) => pattern.test(effect.kind || "");
}

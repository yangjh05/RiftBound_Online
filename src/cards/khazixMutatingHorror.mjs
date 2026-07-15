import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-143",
      "collectorNumber": "UNL-143/219",
      "name": "Kha'Zix, Mutating Horror",
      "type": "unit",
      "isChampion": true,
      "set": "Unleashed",
      "rarity": "Rare",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Champion",
        "Kha'Zix",
        "The Void",
        "Reaction"
      ],
      "keywords": [
        "Reaction",
        "Ambush"
      ],
      "energy": 4,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "might": 4,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-143-219.webp",
      "text": "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\nWhen I attack or defend, if an enemy unit is alone here, give me +2 Might this turn and gain 2 XP.",
      "effects": [
        {
          "timing": "attackOrDefend",
          "kind": "ifEnemyAloneBuffAndXp",
          "amount": 2,
          "temporary": true,
          "xp": 2
        }
      ]
    });

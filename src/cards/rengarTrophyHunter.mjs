import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-120",
      "collectorNumber": "UNL-120/219",
      "name": "Rengar, Trophy Hunter",
      "type": "unit",
      "isChampion": true,
      "set": "Unleashed",
      "rarity": "Epic",
      "domains": [
        DOMAINS.BODY
      ],
      "tags": [
        "Champion",
        "Cat",
        "Rengar",
        "Ixtal",
        "Reaction"
      ],
      "keywords": [
        "Reaction",
        "Ambush"
      ],
      "energy": 5,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "might": 6,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-120-219.webp",
      "text": "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\nI can be played to a battlefield where there are enemy units (even if you don't have units there).",
      "effects": [
        {
          "timing": "static",
          "kind": "canEnterEnemyBattlefield"
        }
      ]
    });

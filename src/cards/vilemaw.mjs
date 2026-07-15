import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-060",
      "collectorNumber": "UNL-060/219",
      "name": "Vilemaw",
      "type": "unit",
      "set": "Unleashed",
      "rarity": "Epic",
      "domains": [
        DOMAINS.CALM
      ],
      "tags": [
        "Shadow Isles",
        "Spider",
        "Reaction"
      ],
      "keywords": [
        "Reaction",
        "Ambush"
      ],
      "energy": 8,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 2
        }
      ],
      "might": 8,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-060-219.webp",
      "text": "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\nEnemy units here with less Might than me don't deal combat damage.\nWhen I hold, draw 1.",
      "effects": [
        {
          "timing": "static",
          "kind": "suppressWeakerEnemyCombatDamage"
        },
        {
          "timing": "hold",
          "kind": "draw",
          "amount": 1
        }
      ]
    });

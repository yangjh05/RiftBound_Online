import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-150",
      "collectorNumber": "UNL-150/219",
      "name": "Vex, Apathetic",
      "type": "unit",
      "isChampion": true,
      "set": "Unleashed",
      "rarity": "Epic",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Champion",
        "Yordle",
        "Vex",
        "Shadow Isles"
      ],
      "keywords": [
        "Deflect"
      ],
      "energy": 4,
      "power": [],
      "might": 4,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-150-219.webp",
      "text": "[Deflect] (Opponents must pay Power to choose me with a spell or ability.)\nWhen an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn. (It doesn't deal combat damage this turn.)",
      "effects": [
        {
          "timing": "opponentPlaysUnit",
          "kind": "stunAndCantMove"
        }
      ]
    });

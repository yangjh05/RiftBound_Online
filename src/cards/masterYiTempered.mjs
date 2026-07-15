import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-113",
      "collectorNumber": "UNL-113/219",
      "name": "Master Yi, Tempered",
      "type": "unit",
      "isChampion": true,
      "set": "Unleashed",
      "rarity": "Rare",
      "domains": [
        DOMAINS.BODY
      ],
      "tags": [
        "Champion",
        "Master Yi",
        "Ionia"
      ],
      "keywords": [
        "Hunt"
      ],
      "energy": 4,
      "power": [],
      "might": 4,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-113-219.webp",
      "text": "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n[Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents must pay Power to choose me with a spell or ability and I can move from battlefield to battlefield.)",
      "effects": [
        {
          "timing": "levelStatic",
          "level": 6,
          "kind": "gainKeywords",
          "keywords": [
            "Deflect",
            "Ganking"
          ]
        }
      ]
    });

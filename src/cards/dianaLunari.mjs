import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-079",
      "collectorNumber": "UNL-079/219",
      "name": "Diana, Lunari",
      "type": "unit",
      "isChampion": true,
      "set": "Unleashed",
      "rarity": "Rare",
      "domains": [
        DOMAINS.MIND
      ],
      "tags": [
        "Champion",
        "Diana",
        "Mount Targon"
      ],
      "keywords": [],
      "energy": 3,
      "power": [],
      "might": 3,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-079-219.webp",
      "text": "When a showdown begins here, you may pay Energy 1. If you do, [Predict], then reveal the top card of your Main Deck. If it's a spell, draw it. (To Predict, look at the top card of your Main Deck. You may recycle it.)",
      "effects": [
        {
          "timing": "showdownBeginsHere",
          "kind": "payEnergyPredictDrawSpell",
          "amount": 1
        }
      ]
    });

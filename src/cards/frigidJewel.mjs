import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-074",
      "collectorNumber": "UNL-074/219",
      "name": "Frigid Jewel",
      "type": "gear",
      "set": "Unleashed",
      "rarity": "Uncommon",
      "domains": [
        DOMAINS.MIND
      ],
      "tags": [],
      "keywords": [],
      "energy": 2,
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-074-219.webp",
      "text": "When you draw your second card each turn, give a friendly unit +2 Might this turn.",
      "effects": [
        {
          "timing": "secondDrawEachTurn",
          "kind": "modifyMight",
          "target": "friendlyUnit",
          "amount": 2
        }
      ]
    });

import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-070",
      "collectorNumber": "UNL-070/219",
      "name": "Turn to Dust",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Common",
      "domains": [
        DOMAINS.MIND
      ],
      "tags": [],
      "keywords": [],
      "energy": 2,
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-070-219.webp",
      "text": "Give a gear [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)",
      "effects": [
        {
          "timing": "spell",
          "kind": "giveTemporaryGear"
        }
      ]
    });

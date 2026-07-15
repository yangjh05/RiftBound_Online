import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-063",
      "collectorNumber": "UNL-063/219",
      "name": "Eclipse",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Common",
      "domains": [
        DOMAINS.MIND
      ],
      "tags": [
        "Reaction"
      ],
      "keywords": [
        "Reaction"
      ],
      "energy": 3,
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-063-219.webp",
      "text": "[Reaction] (Play any time, even before spells and abilities resolve.)\nGive a unit -4 Might this turn.\n[Predict]. (Look at the top card of your Main Deck. You may recycle it.)",
      "effects": [
        {
          "timing": "spell",
          "kind": "modifyMight",
          "target": "unit",
          "amount": -4,
          "temporary": true,
          "predict": true
        }
      ]
    });

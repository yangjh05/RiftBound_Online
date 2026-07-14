import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-128",
      "collectorNumber": "UNL-128/219",
      "name": "Star-Crossed",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Common",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Reaction"
      ],
      "keywords": [
        "Reaction"
      ],
      "energy": 3,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-128-219.webp",
      "text": "[Reaction] (Play any time, even before spells and abilities resolve.)\nReturn a friendly unit and an enemy unit to their owners' hands.",
      "effects": [
        {
          "timing": "spell",
          "kind": "returnFriendlyAndEnemyToHand"
        }
      ]
    });

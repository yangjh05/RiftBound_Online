import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "OGS-011",
      "collectorNumber": "OGS-011/024",
      "name": "Flash",
      "type": "spell",
      "set": "Proving Grounds",
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
      "energy": 2,
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/OGS-011-024.webp",
      "text": "[Reaction] (Play any time, even before spells and abilities resolve.)\nMove up to 2 friendly units to base.",
      "effects": [
        {
          "timing": "spell",
          "kind": "moveFriendlyUnitsToBase",
          "max": 2
        }
      ]
    });

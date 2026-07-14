import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-136",
      "collectorNumber": "SFD-136/221",
      "name": "Hard Bargain",
      "type": "spell",
      "set": "Spiritforged",
      "rarity": "Uncommon",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Reaction"
      ],
      "keywords": [
        "Reaction",
        "Repeat"
      ],
      "energy": 2,
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-136-221.webp",
      "text": "[Reaction] (Play any time, even before spells and abilities resolve.)\n[Repeat] Energy 2 (You may pay the additional cost to repeat this spell's effect.)\nCounter a spell unless its controller pays Energy 2.",
      "effects": [
        {
          "timing": "spell",
          "kind": "counterUnlessPayEnergy",
          "amount": 2,
          "repeatCostEnergy": 2
        }
      ]
    });

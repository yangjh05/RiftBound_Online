import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-097",
      "collectorNumber": "SFD-097/221",
      "name": "Punch First",
      "type": "spell",
      "set": "Spiritforged",
      "rarity": "Common",
      "domains": [
        DOMAINS.BODY
      ],
      "tags": [
        "Action"
      ],
      "keywords": [
        "Action"
      ],
      "energy": 1,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 2
        }
      ],
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-097-221.webp",
      "text": "[Action] (Play on your turn or in showdowns.)\nGive a unit +5 Might this turn.",
      "effects": [
        {
          "timing": "spell",
          "kind": "modifyMight",
          "target": "unit",
          "amount": 5,
          "temporary": true
        }
      ]
    });

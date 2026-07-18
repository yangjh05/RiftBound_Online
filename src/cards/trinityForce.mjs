import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-115",
      "collectorNumber": "SFD-115/221",
      "name": "Trinity Force",
      "type": "gear",
      "set": "Spiritforged",
      "rarity": "Rare",
      "domains": [
        DOMAINS.BODY
      ],
      "tags": [
        "Equipment"
      ],
      "keywords": [
        "Equip"
      ],
      "energy": 4,
      "power": [],
      "might": 2,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-115-221.webp",
      "text": "[Equip] Body Power (Body Power: Attach this to a unit you control.)",
      "effects": [
        {
          "timing": "activated",
          "exhaust": false,
          "kind": "equip",
          "domain": "Body"
        },
        {
          "timing": "static",
          "kind": "attachedMight",
          "textSection": "mightBonus",
          "amount": 2
        }
      ]
    });

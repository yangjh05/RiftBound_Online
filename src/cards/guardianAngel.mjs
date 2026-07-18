import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-051",
      "collectorNumber": "SFD-051/221",
      "name": "Guardian Angel",
      "type": "gear",
      "set": "Spiritforged",
      "rarity": "Rare",
      "domains": [
        DOMAINS.CALM
      ],
      "tags": [
        "Equipment"
      ],
      "keywords": [
        "Equip"
      ],
      "energy": 2,
      "power": [],
      "might": 1,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-051-221.webp",
      "text": "[Equip] Calm Power (Calm Power: Attach this to a unit you control.)",
      "effects": [
        {
          "timing": "activated",
          "exhaust": false,
          "kind": "equip",
          "domain": "Calm"
        },
        {
          "timing": "static",
          "kind": "attachedMight",
          "textSection": "mightBonus",
          "amount": 1
        }
      ]
    });

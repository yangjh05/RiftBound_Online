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
      "image": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d09a797345659a1853d6d12910cf3c634990ea0c-744x1039.png?accountingTag=RB",
      "text": "[Equip] Calm Power (Calm Power : Attach this to a unit you control.)\nIf I would die, kill Guardian Angel instead. Heal me, exhaust me, and recall me.",
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
        },
        {
          "timing": "replacement",
          "kind": "saveFriendlyUnitByKillingThis",
          "textSection": "effect"
        }
      ]
    });

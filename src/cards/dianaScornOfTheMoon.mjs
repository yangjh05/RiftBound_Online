import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-197",
      "collectorNumber": "UNL-197/219",
      "name": "Diana, Scorn of the Moon",
      "type": "legend",
      "set": "Unleashed",
      "rarity": "Rare",
      "domains": [
        DOMAINS.MIND,
        DOMAINS.CHAOS
      ],
      "tags": [
        "Diana"
      ],
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/image_fx_1773677896097.webp",
      "text": "[Reaction][>] Exhaust: [Add] Energy 1. Spend this Energy only during showdowns. (Abilities that add resources can't be reacted to.)",
      "effects": [
        {
          "timing": "activated",
          "exhaust": true,
          "kind": "addEnergy",
          "amount": 1,
          "restriction": "showdown",
          "abilityKeywords": ["Reaction"]
        }
      ]
    });

import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-053",
      "collectorNumber": "UNL-053/219",
      "name": "Scuttle Crab",
      "type": "unit",
      "set": "Unleashed",
      "rarity": "Rare",
      "domains": [
        DOMAINS.CALM
      ],
      "tags": [
        "Bilgewater"
      ],
      "keywords": [
        "Deathknell"
      ],
      "energy": 2,
      "power": [],
      "might": 0,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-053-219.webp",
      "text": "(Units with 0 Might can conquer and hold.)\nWhen you play me, draw 1.\n[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. Gain 1 XP. (When I die, get the effects.)",
      "effects": [
        {
          "timing": "onPlay",
          "kind": "draw",
          "amount": 1
        },
        {
          "timing": "death",
          "kind": "revealOpponentHand",
          "abilityId": "deathknell"
        },
        {
          "timing": "death",
          "kind": "gainXp",
          "abilityId": "deathknell",
          "amount": 1
        }
      ]
    });

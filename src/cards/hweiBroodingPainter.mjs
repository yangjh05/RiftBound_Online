import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-080",
      "collectorNumber": "UNL-080/219",
      "name": "Hwei, Brooding Painter",
      "type": "unit",
      "isChampion": true,
      "set": "Unleashed",
      "rarity": "Rare",
      "domains": [
        DOMAINS.MIND
      ],
      "tags": [
        "Ionia",
        "Hwei"
      ],
      "keywords": [],
      "energy": 5,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "might": 5,
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-080-219.webp",
      "text": "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's type:\n- Spell - Draw 1.\n- Gear - Ready up to 2 runes.\n- Unit - Give me +3 Might this turn.",
      "effects": [
        {
          "timing": "onMove",
          "kind": "drawDiscardTypeBonus"
        }
      ]
    });

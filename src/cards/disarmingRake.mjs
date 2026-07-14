import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-032",
      "collectorNumber": "SFD-032/221",
      "name": "Disarming Rake",
      "type": "unit",
      "set": "Spiritforged",
      "rarity": "Common",
      "domains": [
        DOMAINS.CALM
      ],
      "tags": [
        "Demacia"
      ],
      "keywords": [],
      "energy": 3,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "might": 2,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-032-221.webp",
      "text": "When you play me, you may kill a gear.",
      "effects": [
        {
          "timing": "onPlay",
          "kind": "killGear",
          "optional": true
        }
      ]
    });

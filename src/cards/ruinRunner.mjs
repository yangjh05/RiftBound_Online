import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-105",
      "collectorNumber": "SFD-105/221",
      "name": "Ruin Runner",
      "type": "unit",
      "set": "Spiritforged",
      "rarity": "Uncommon",
      "domains": [
        DOMAINS.BODY
      ],
      "tags": [
        "Shurima"
      ],
      "keywords": [],
      "energy": 6,
      "power": [],
      "might": 5,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-105-221.webp",
      "text": "I can't be chosen by enemy spells and abilities.",
      "effects": [
        {
          "timing": "static",
          "kind": "cannotBeChosenByEnemy"
        }
      ]
    });

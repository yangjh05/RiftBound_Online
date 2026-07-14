import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-036",
      "collectorNumber": "SFD-036/221",
      "name": "Lonely Poro",
      "type": "unit",
      "set": "Spiritforged",
      "rarity": "Common",
      "domains": [
        DOMAINS.CALM
      ],
      "tags": [
        "Poro",
        "Freljord"
      ],
      "keywords": [
        "Deathknell"
      ],
      "energy": 2,
      "power": [],
      "might": 2,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-036-221.webp",
      "text": "[Deathknell] - If I died alone, draw 1. (When I die, get the effect. I'm alone if there are no other friendly units here.)",
      "effects": [
        {
          "timing": "death",
          "kind": "drawIfAlone",
          "draw": 1
        }
      ]
    });

import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-109",
      "collectorNumber": "SFD-109/221",
      "name": "Akshan, Mischievous",
      "type": "unit",
      "isChampion": true,
      "set": "Spiritforged",
      "rarity": "Rare",
      "domains": [
        DOMAINS.BODY
      ],
      "tags": [
        "Champion",
        "Akshan",
        "Shurima",
        "Sentinel"
      ],
      "keywords": [
        "Weaponmaster"
      ],
      "energy": 4,
      "power": [],
      "might": 4,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-109-221.webp",
      "text": "[Weaponmaster]\nYou may pay Body PowerBody Power as an additional cost to play me.\nWhen you play me, if you paid the additional cost, move an enemy gear to your base. You control it until I leave the board. If it's an Equipment, attach it to me.",
      "effects": [
        {
          "timing": "onPlay",
          "kind": "stealEnemyGear",
          "optional": true,
          "additionalPower": {
            "domain": "Body",
            "amount": 2
          }
        }
      ]
    });

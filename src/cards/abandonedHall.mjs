import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-205",
      "collectorNumber": "UNL-205/219",
      "name": "Abandoned Hall",
      "type": "battlefield",
      "set": "Unleashed",
      "rarity": "Uncommon",
      "domains": [],
      "tags": [],
      "keywords": [],
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-205-219.webp",
      "text": "When a player plays a spell, they may give a unit they control here +1 Might this turn.",
      "effects": [
        {
          "timing": "spellPlayed",
          "kind": "battlefieldBuffUnitHere",
          "amount": 1,
          "optional": true
        }
      ]
    });

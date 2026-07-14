import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-192",
      "collectorNumber": "UNL-192/219",
      "name": "Alpha Strike",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Epic",
      "domains": [
        DOMAINS.CALM,
        DOMAINS.BODY
      ],
      "tags": [
        "Master Yi",
        "Action"
      ],
      "keywords": [
        "Action"
      ],
      "energy": 3,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-192-219.webp",
      "text": "[Action] (Play on your turn or in showdowns.)\nChoose a friendly unit. It deals damage equal to its Might split among enemy units at battlefields. Then for each unit this kills, do this: Gain 1 XP.",
      "effects": [
        {
          "timing": "spell",
          "kind": "alphaStrike",
          "target": "friendlyUnit",
          "gainXpPerKill": 1
        }
      ]
    });

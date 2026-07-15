import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-198",
      "collectorNumber": "UNL-198/219",
      "name": "Moonfall",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Epic",
      "domains": [
        DOMAINS.MIND,
        DOMAINS.CHAOS
      ],
      "tags": [
        "Signature",
        "Diana",
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
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-198-219.webp",
      "text": "[Action] (Play on your turn or in showdowns.)\nChoose a battlefield where you have units. You may move up to one enemy unit to that battlefield. Then give enemy units there -2 Might this turn.",
      "effects": [
        {
          "timing": "spell",
          "kind": "moonfall",
          "temporary": true
        }
      ]
    });

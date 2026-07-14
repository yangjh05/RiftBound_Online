import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-134",
      "collectorNumber": "UNL-134/219",
      "name": "Existential Dread",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Uncommon",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Action"
      ],
      "keywords": [
        "Action",
        "Repeat"
      ],
      "energy": 1,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-134-219.webp",
      "text": "[Action] (Play on your turn or in showdowns.)\n[Repeat] Energy 2 (You may pay the additional cost to repeat this spell's effect.)\n[Stun] an attacking enemy unit. If it's already stunned, return it to its owner's hand instead. (A stunned unit doesn't deal combat damage this turn.)",
      "effects": [
        {
          "timing": "spell",
          "kind": "stunOrReturnAttackingEnemy",
          "repeatCostEnergy": 2
        }
      ]
    });

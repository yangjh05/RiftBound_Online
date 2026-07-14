import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "UNL-042",
      "collectorNumber": "UNL-042/219",
      "name": "Back Off",
      "type": "spell",
      "set": "Unleashed",
      "rarity": "Uncommon",
      "domains": [
        DOMAINS.CALM
      ],
      "tags": [
        "Action",
        "Hidden"
      ],
      "keywords": [
        "Action",
        "Hidden"
      ],
      "energy": 3,
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/UNL-042-219.webp",
      "text": "[Hidden] (Hide now for Power to react with later for Energy 0.)\n[Action] (Play on your turn or in showdowns.)\n[Stun] a unit. (It doesn't deal combat damage this turn.)\nIf you played this from your hand, draw 1.",
      "effects": [
        {
          "timing": "spell",
          "kind": "stunUnit",
          "target": "unit",
          "drawIfFromHand": 1
        }
      ]
    });

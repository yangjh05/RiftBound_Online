import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "OGS-019",
      "collectorNumber": "OGS-019/024-669266",
      "name": "Master Yi, Wuju Bladesman",
      "type": "legend",
      "set": "Proving Grounds",
      "rarity": "Rare",
      "domains": [
        DOMAINS.CALM,
        DOMAINS.BODY
      ],
      "tags": [
        "Champion",
        "Master Yi"
      ],
      "keywords": [],
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/OGS-019-024-669266.webp",
      "text": "While a friendly unit defends alone, it gets +2 Might.",
      "effects": [
        {
          "timing": "static",
          "kind": "defendAloneMight",
          "amount": 2
        }
      ]
    });

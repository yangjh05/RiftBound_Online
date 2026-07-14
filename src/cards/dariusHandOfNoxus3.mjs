import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-302s",
  collectorNumber: "OGN-302/298",
  cardNumber: "OGN-302s/298",
  name: "Darius, Hand of Noxus",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.FURY, DOMAINS.ORDER],
  tags: ["Darius","Reaction"],
  keywords: ["Legion"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-302s.webp",
  text: "Tap REACTION, LEGION - ADD 1 (Abilities that add resources can't be reacted to. Get the effect if you've played a card this turn.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Fury",
      "Order"
    ],
    "restriction": null,
    "nonReactive": true,
    "requiresLegion": true
  }
]
});

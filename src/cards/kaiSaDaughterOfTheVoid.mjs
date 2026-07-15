import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-247",
  collectorNumber: "OGN-247/298",
  name: "Kai'Sa, Daughter of the Void",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY, DOMAINS.MIND],
  tags: ["Champion", "Kai'Sa"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-247.webp",
  text: "Tap: REACTION - ADD Rune. Use only to play spells. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "kind": "addEnergy",
    "amount": 1,
    "domains": [
      "Fury",
      "Mind"
    ],
    "restriction": "spell",
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});

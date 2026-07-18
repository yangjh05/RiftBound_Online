import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-299",
  collectorNumber: "OGN-299/298",
  name: "Kai'Sa, Daughter of the Void",
  type: "legend",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.FURY, DOMAINS.MIND],
  tags: ["Kai'Sa"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-299.webp",
  text: "Tap: REACTION - ADD 1 Any Power. Use only to play spells. (Abilities that add resources can't be reacted to.)",
  effects: [
  {
    "timing": "activated",
    "exhaust": true,
    "kind": "addPower",
    "amount": 1,
    "domain": "Any",
    "restriction": "spell",
    "nonReactive": true,
    "abilityKeywords": ["Reaction"]
  }
]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-213",
  collectorNumber: "OGN-213/298",
  name: "Hidden Blade",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Action"],
  keywords: ["Hidden"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-213.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nACTION (Play on your turn or in showdowns.)\nKill a unit at a battlefield. Its controller draws 2.",
  effects: [
  {
    "timing": "spell",
    "kind": "killUnit",
    "target": "battlefieldUnit",
    "drawController": 2
  }
]
});

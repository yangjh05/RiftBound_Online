import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-080",
  collectorNumber: "OGN-080/298",
  name: "Mystic Reversal",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM],
  tags: ["Reaction"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 3 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-080.webp",
  text: "Reaction (Play any time, even before spells and abilities resolve.)\nGain control of a spell. You may make new choices for it.",
  effects: [{ timing: "spell", kind: "gainControlOfSpell" }]
});

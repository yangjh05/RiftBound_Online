import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-244",
  collectorNumber: "OGN-244/298",
  name: "Divine Judgment",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.ORDER],
  tags: [],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-244.webp",
  text: "Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands. Recycle the rest.",
  effects: [{ timing: "spell", kind: "divineJudgment" }]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-230",
  collectorNumber: "OGN-230/298",
  name: "Albus Ferros",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Piltover"],
  keywords: [],
  energy: 4,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-230.webp",
  text: "When you play me, spend any number of buffs.\nFor each buff spent, channel 1 rune exhausted.",
  effects: [
    {
      timing: "onPlay",
      kind: "spendBuffsChannelRunes"
    }
  ]
});

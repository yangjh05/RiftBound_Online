import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-019",
  collectorNumber: "OGN-019/298",
  name: "Raging Soul",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.FURY],
  tags: ["Shadow Isles","Spirit"],
  keywords: [],
  energy: 4,
  power: [],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-019.webp",
  text: "If you've discarded a card this turn, I have ASSAULT and GANKING. (+1 MIGHT while I'm an attacker. I can move from battlefield to battlefield)",
  effects: [
    {
      timing: "static",
      kind: "gainKeywordsIfDiscardedThisTurn",
      keywords: ["Assault", "Ganking"]
    }
  ]
});

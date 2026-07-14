import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-251",
  collectorNumber: "OGN-251/298",
  name: "Jinx, Loose Cannon",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY, DOMAINS.CHAOS],
  tags: ["Jinx"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-251.webp",
  text: "At start of your Beginning Phase, draw 1 if you have 1 or fewer cards in your hand.",
  effects: [
    {
      timing: "beginning",
      kind: "drawIfHandSizeAtMost",
      maxHandSize: 1,
      amount: 1
    }
  ]
});

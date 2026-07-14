import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-101",
  collectorNumber: "OGN-101/298",
  name: "Mushroom Pouch",
  type: "gear",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.MIND],
  tags: [],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-101.webp",
  text: "At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1.",
  effects: [
    {
      timing: "beginning",
      kind: "drawIfControlsHidden",
      amount: 1
    }
  ]
});

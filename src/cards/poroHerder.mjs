import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-061",
  collectorNumber: "OGN-061/298",
  name: "Poro Herder",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Freljord"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-061.webp",
  text: "When you play me, if you control a Poro, buff me and draw 1. (if I don't have a buff, I get a +1 Might buff.)",
  effects: [
    { timing: "onPlay", kind: "buffSelfDrawIfControlTag", tag: "Poro", amount: 1, draw: 1 }
  ]
});

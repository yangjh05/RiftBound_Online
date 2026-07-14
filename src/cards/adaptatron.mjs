import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-056",
  collectorNumber: "OGN-056/298",
  name: "Adaptatron",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Piltover","Mech"],
  keywords: [],
  energy: 4,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-056.webp",
  text: "When I conquer, you may kill a gear. If you do, buff me. (If I don't have a buff, I get a +1 Might buff.)",
  effects: [
    { timing: "score", kind: "killGearThenBuffSelf", reason: "conquer", amount: 1 }
  ]
});

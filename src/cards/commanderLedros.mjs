import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-231",
  collectorNumber: "OGN-231/298",
  name: "Commander Ledros",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.ORDER],
  tags: ["Shadow Isles","Spirit"],
  keywords: ["Deflect","Ganking"],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 4 }],
  might: 8,
  image: "https://cdn.piltoverarchive.com/cards/OGN-231.webp",
  text: "As you play me, you may kill any number of friendly units as an additional cost. Reduce my cost by Order for each killed this way.\nDeflect (Opponents must pay Rune to choose me with a spell or ability.)\nGanking (I can move from battlefield to battlefield.)",
  additionalCost: { kind: "killFriendlyUnitsReducePower" },
  effects: [{ timing: "static", kind: "killFriendlyUnitsCostReduction", domain: DOMAINS.ORDER }]
});

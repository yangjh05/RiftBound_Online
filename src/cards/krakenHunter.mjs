import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-150",
  collectorNumber: "OGN-150/298",
  name: "Kraken Hunter",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Bilgewater","Pirate"],
  keywords: ["Accelerate","Assault"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-150.webp",
  text: "Accelerate (You may pay 1 body as an additional cost to have me enter ready.)\nAssault (+1 might while i'm an attacker.)\nAs you play me, you may spend any number of buffs as an additional cost. Reduce my cost by body for each buff you spend.",
  additionalCost: { kind: "spendFriendlyBuffsReducePower" },
  effects: [{ timing: "static", kind: "spendBuffsCostReduction", domain: DOMAINS.BODY }]
});

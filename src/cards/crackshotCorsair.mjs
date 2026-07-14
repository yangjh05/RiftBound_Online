import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-130",
  collectorNumber: "OGN-130/298",
  name: "Crackshot Corsair",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Bilgewater","Pirate"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-130.webp",
  text: "When I attack, deal 1 to an enemy unit here.",
  effects: [
    { timing: "attackOrDefend", kind: "dealDamageEnemyHere", role: "attacker", amount: 1 }
  ]
});

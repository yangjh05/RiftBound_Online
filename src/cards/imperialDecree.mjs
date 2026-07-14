import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-221",
  collectorNumber: "OGN-221/298",
  name: "Imperial Decree",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Action"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-221.webp",
  text: "action (Play on your turn or in showdowns.) When any unit takes damage this turn, kill it.",
  effects: [
    {
      timing: "spell",
      kind: "killDamagedUnitsThisTurn"
    }
  ]
});

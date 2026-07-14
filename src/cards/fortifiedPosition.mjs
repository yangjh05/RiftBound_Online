import { card } from "./shared.mjs";

export default card({
  id: "OGN-279",
  collectorNumber: "OGN-279/298",
  name: "Fortified Position",
  type: "battlefield",
  set: "Origins",
  rarity: "Uncommon",
  domains: [],
  tags: [],
  keywords: ["Shield"],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-279.webp?rotate=90&width=3840",
  text: "When you defend here, choose a unit. It gains [SHIELD 2] this combat. (+2 Might while It's a defender.)",
  effects: [
    {
      timing: "defendHere",
      kind: "giveShieldHere",
      amount: 2
    }
  ]
});

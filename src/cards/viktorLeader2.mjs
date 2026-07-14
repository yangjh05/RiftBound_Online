import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-246a",
  collectorNumber: "OGN-246a/298",
  name: "Viktor, Leader",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Viktor","Zaun"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-246a.webp",
  text: "When another non-Recruit unit you control dies, play a 1 Might Recruit unit token into your base.",
  effects: [
    {
      timing: "death",
      kind: "playRecruitOnOtherFriendlyNonRecruitDeath",
      tokenCardNumber: "OGN-273/298",
      count: 1,
      destination: "base"
    }
  ]
});

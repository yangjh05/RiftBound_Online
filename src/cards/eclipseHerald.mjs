import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-059",
  collectorNumber: "OGN-059/298",
  name: "Eclipse Herald",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CALM],
  tags: ["Mount Targon","Bird"],
  keywords: [],
  energy: 7,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 7,
  image: "https://cdn.piltoverarchive.com/cards/OGN-059.webp",
  text: "When you stun an enemy unit, ready me and give me +1 Might this turn.",
  effects: [
    {
      timing: "stun",
      kind: "readySelfMight",
      amount: 1
    }
  ]
});

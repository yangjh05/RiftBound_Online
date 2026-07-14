import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-055",
  collectorNumber: "OGN-055/298",
  name: "Wielder of Water",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Ionia"],
  keywords: [],
  energy: 3,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-055.webp",
  text: "While I'm attacking or defending alone, I have +2 Might.",
  effects: [
    {
      timing: "static",
      kind: "selfMightWhileAloneCombat",
      amount: 2
    }
  ]
});

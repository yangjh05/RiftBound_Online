import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-189",
  collectorNumber: "OGN-189/298",
  name: "Kayn, Unleashed",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Kayn","Ionia"],
  keywords: ["Ganking"],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-189.webp",
  text: "GANKING (I can move from battlefield to battlefield.)\nIf I have moved twice this turn, I don't take damage.",
  effects: [{ timing: "static", kind: "preventDamageAfterSecondMove" }]
});

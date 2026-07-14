import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-249",
  collectorNumber: "OGN-249/298",
  name: "Volibear, Relentless Storm",
  type: "legend",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY, DOMAINS.FURY],
  tags: ["Volibear"],
  keywords: [],
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-249.webp",
  text: "When you play a MIGHTY unit, you may exhaust me to channel 1 rune exhausted. (A unit is Mighty while it has 5+ Might",
  effects: [
    {
      timing: "cardPlayed",
      kind: "exhaustSelfChannelOnMightyUnit",
      minMight: 5,
      amount: 1
    }
  ]
});

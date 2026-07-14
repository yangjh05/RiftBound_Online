import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-026",
  collectorNumber: "OGN-026/298",
  name: "Brynhir Thundersong",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Freljord"],
  keywords: [],
  energy: 6,
  power: [],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-026.webp",
  text: "When you play me, opponents can't play cards this turn.",
  effects: [
    {
      timing: "onPlay",
      kind: "preventOpponentsPlayCardsThisTurn"
    }
  ]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-096",
  collectorNumber: "OGN-096/298",
  name: "Watchful Sentry",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.MIND],
  tags: ["Freljord"],
  keywords: ["Deathknell"],
  energy: 2,
  power: [],
  might: 1,
  image: "https://cdn.piltoverarchive.com/cards/OGN-096.webp",
  text: "DEATHKNELL - Draw 1. (When I die, get the effect.)",
  effects: [
  {
    "timing": "death",
    "kind": "draw",
    "amount": 1
  }
]
});

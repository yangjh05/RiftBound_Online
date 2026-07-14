import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-216",
  collectorNumber: "OGN-216/298",
  name: "Soaring Scout",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Freljord","Bird"],
  keywords: ["Deathknell"],
  energy: 2,
  power: [],
  might: 1,
  image: "https://cdn.piltoverarchive.com/cards/OGN-216.webp",
  text: "DEATHKNELL - Channel 1 rune exhausted. (When I die, get the effect.)",
  effects: [
  {
    "timing": "death",
    "kind": "channelRunes",
    "amount": 1
  }
]
});

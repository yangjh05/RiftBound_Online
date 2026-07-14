import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-137",
  collectorNumber: "OGN-137/298",
  name: "Stormclaw Ursine",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.BODY],
  tags: ["Freljord"],
  keywords: ["Tank"],
  energy: 7,
  power: [],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-137.webp",
  text: "TANK (I must be assigned combat damage first.)\nWhen you play me, channel 1 rune exhausted.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "channelRunes",
    "amount": 1
  }
]
});

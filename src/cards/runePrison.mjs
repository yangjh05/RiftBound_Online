import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-050",
  collectorNumber: "OGN-050/298",
  name: "Rune Prison",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CALM],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-050.webp",
  text: "Action (Play on your turn or in showdowns.)\nStun a unit. (It doesn't deal combat damage this turn.)",
  effects: [
  {
    "timing": "spell",
    "kind": "stunUnit",
    "target": "unit"
  }
]
});

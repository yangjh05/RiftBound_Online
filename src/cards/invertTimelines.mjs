import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-201",
  collectorNumber: "OGN-201/298",
  name: "Invert Timelines",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-201.webp",
  text: "Each player discards their hand, then draws 4.",
  effects: [
  {
    "timing": "spell",
    "kind": "discardHandDraw",
    "amount": 4
  }
]
});

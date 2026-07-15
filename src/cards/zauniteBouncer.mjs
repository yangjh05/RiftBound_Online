import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-188",
  collectorNumber: "OGN-188/298",
  name: "Zaunite Bouncer",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: ["Zaun"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-188.webp",
  text: "When you play me, return another unit at a battlefield to its owner's hand.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "returnBattlefieldUnitToHand",
    "optional": false
  }
]
});

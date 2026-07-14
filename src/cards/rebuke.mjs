import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-172",
  collectorNumber: "OGN-172/298",
  name: "Rebuke",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: ["Action"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-172-298.webp",
  text: "[Action] (Play on your turn or in showdowns.)\nReturn a unit at a battlefield to its owner's hand.",
  effects: [
  {
    "timing": "spell",
    "kind": "returnBattlefieldUnitToHand"
  }
]
});

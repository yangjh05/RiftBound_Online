import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-173",
  collectorNumber: "OGN-173/298",
  name: "Ride the Wind",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Action"],
  keywords: ["Action"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://exburst.dev/riftbound/cards/sd/OGN-173-298.webp",
  text: "[Action] (Play on your turn or in showdowns.)\nMove a friendly unit and ready it.",
  effects: [
  {
    "timing": "spell",
    "kind": "moveFriendlyAndReady"
  }
]
});

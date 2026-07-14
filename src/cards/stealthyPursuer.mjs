import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-177",
  collectorNumber: "OGN-177/298",
  name: "Stealthy Pursuer",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Shurima"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-177.webp",
  text: "When a friendly unit moves from my location, I may be moved with it.",
  effects: [
    {
      timing: "onMove",
      kind: "moveWithFriendlyFromSameBattlefield"
    }
  ]
});

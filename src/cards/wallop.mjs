import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-146",
  collectorNumber: "OGN-146/298",
  name: "Wallop",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.BODY],
  tags: ["Action"],
  keywords: [],
  energy: 2,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-146.webp",
  text: "Action (Play on your turn or in showdowns.)\nAs you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost. Ready a unit.",
  additionalCost: { kind: "optionalSpendFriendlyBuffIgnoreCost" },
  effects: [
    { timing: "spell", kind: "readyUnitAny" }
  ]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-206",
  collectorNumber: "OGN-206/298",
  name: "Back to Back",
  type: "spell",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Reaction"],
  keywords: [],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-206.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve.)\nGive two friendly units each +2 Might this turn.",
  effects: [
    { timing: "spell", kind: "modifyMight", target: "friendlyUnit", amount: 2, repeat: 2, temporary: true }
  ]
});

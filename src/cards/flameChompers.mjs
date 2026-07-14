import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-006",
  collectorNumber: "OGN-006/298",
  name: "Flame Chompers",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Zaun"],
  keywords: [],
  energy: 3,
  power: [],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-006.webp",
  text: "When you discard me, you may pay Fury to play me.",
  effects: [{ timing: "discarded", kind: "playSelfFromTrashPayPower", domain: DOMAINS.FURY }]
});

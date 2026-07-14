import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-208",
  collectorNumber: "OGN-208/298",
  name: "Cruel Patron",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.ORDER],
  tags: ["Noxus"],
  keywords: [],
  energy: 4,
  power: [],
  might: 6,
  image: "https://cdn.piltoverarchive.com/cards/OGN-208.webp",
  text: "As an additional cost to play me, kill a friendly unit.",
  additionalCost: { kind: "killFriendlyUnit" },
  effects: []
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-003",
  collectorNumber: "OGN-003/298",
  name: "Chemtech Enforcer",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.FURY],
  tags: ["Zaun"],
  keywords: ["Assault"],
  energy: 2,
  power: [],
  might: 2,
  image: "https://cdn.piltoverarchive.com/cards/OGN-003.webp",
  text: "ASSAULT (+2 Might while I'm an attacker.)\nWhen you play me, discard 1.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "discard",
          "amount": 1
      }
  ]
});

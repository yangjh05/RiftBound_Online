import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-038",
  collectorNumber: "OGN-038/298",
  name: "Kadregrin the Infernal",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY],
  tags: ["Demacia","Dragon"],
  keywords: [],
  energy: 9,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 9,
  image: "https://cdn.piltoverarchive.com/cards/OGN-038.webp",
  text: "When you play me, draw 1 for each of your MIGHTY units. (A unit is Mighty while it has 5+ Might.)",
  effects: [
    {
      timing: "onPlay",
      kind: "drawPerFriendlyMightyUnit",
      threshold: 5
    }
  ]
});

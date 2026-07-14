import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-180",
  collectorNumber: "OGN-180/298",
  name: "Fading Memories",
  type: "spell",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: ["Temporary"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-180.webp",
  text: "Give a unit at a battlefield or a gear temporary. (Kill it at the start of its controller's Beginning Phase, before.)",
  effects: [
    { timing: "spell", kind: "giveTemporaryUnitOrGear" }
  ]
});

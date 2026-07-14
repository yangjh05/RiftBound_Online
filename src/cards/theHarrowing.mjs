import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-198",
  collectorNumber: "OGN-198/298",
  name: "The Harrowing",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: [],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-198.webp",
  text: "Play a unit from your trash, ignoring its Energy cost. (You must still pay its Power cost.)",
  effects: [
    {
      timing: "spell",
      kind: "playUnitFromTrash"
    }
  ]
});

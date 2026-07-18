import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-068",
  collectorNumber: "OGN-068/298",
  name: "Caitlyn, Patrolling",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CALM],
  tags: ["Champion","Piltover","Caitlyn"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-068.webp",
  text: "I must be assigned combat damage last.\nTap: Deal damage equal to my Might to a unit at a battlefield. Use this ability only while I'm at a battlefield.",
  effects: [
      {
          "timing": "static",
          "kind": "combatDamageAssignmentLast"
      },
      {
          "timing": "activated",
          "exhaust": true,
          "kind": "dealDamageUnit",
          "target": "battlefieldUnit",
          "amountFromSelfMight": true,
          "sourceLocation": "battlefield"
      }
  ]
});

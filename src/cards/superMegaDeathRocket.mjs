import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-252",
  collectorNumber: "OGN-252/298",
  name: "Super Mega Death Rocket!",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY, DOMAINS.CHAOS],
  tags: ["Signature", "Signature Spell", "Jinx"],
  keywords: [],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-252.webp",
  text: "Deal 5 to a unit.\nWhen you conquer, you may discard 1 to return this from your trash to your hand.",
  effects: [
  {
    "timing": "spell",
    "kind": "dealDamageUnit",
    "target": "unit",
    "amount": 5
  },
  {
    "timing": "battlefieldControl",
    "kind": "discardReturnSelfFromTrash",
    "event": "conquer",
    "amount": 1,
    "optional": true
  }
]
});

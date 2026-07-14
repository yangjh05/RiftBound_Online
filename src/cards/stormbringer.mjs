import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-250",
  collectorNumber: "OGN-250/298",
  name: "Stormbringer",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY, DOMAINS.FURY],
  tags: ["Signature Spell","Volibear"],
  keywords: [],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-250.webp",
  text: "Choose a friendly unit in your base. Deal damage equal to its Might to all enemy units at a battlefield, then move your unit there.",
  effects: [
    { timing: "spell", kind: "stormbringer" }
  ]
});

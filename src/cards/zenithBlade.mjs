import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-262",
  collectorNumber: "OGN-262/298",
  name: "Zenith Blade",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM, DOMAINS.ORDER],
  tags: ["Signature", "Signature Spell", "Leona", "Action"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-262.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nStun an enemy at a battlefield. You may move a friendly unit to that enemy unit's battlefield. (A stunned unit doesn't deal combat damage this turn.)",
  effects: [
    { timing: "spell", kind: "zenithBlade" }
  ]
});

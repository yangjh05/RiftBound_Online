import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-254",
  collectorNumber: "OGN-254/298",
  name: "Noxian Guillotine",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY, DOMAINS.ORDER],
  tags: ["Signature Spell","Darius","Action"],
  keywords: ["Legion"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-254.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nChoose a unit. Kill it the next time it takes damage this turn.\nLEGION - Kill it now instead. (Get the effect if you've played another card this turn.)",
  effects: [
    {
      timing: "spell",
      kind: "killOnNextDamageOrNowIfLegion"
    }
  ]
});

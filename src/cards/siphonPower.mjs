import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-266",
  collectorNumber: "OGN-266/298",
  name: "Siphon Power",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.ORDER, DOMAINS.MIND],
  tags: ["Signature", "Signature Spell", "Viktor", "Reaction"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-266.webp",
  text: "REACTION (Play any time, even before spells and abilities resolve.)\nChoose a battlefield. Give friendly units there +1 Might this turn and enemy units there -1 Might this turn, to a minimum of 1 Might.",
  effects: [
    { timing: "spell", kind: "siphonPower", temporary: true }
  ]
});

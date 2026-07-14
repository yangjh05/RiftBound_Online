import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-270",
  collectorNumber: "OGN-270/298",
  name: "Showstopper",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY, DOMAINS.ORDER],
  tags: ["Signature Spell","Sett"],
  keywords: [],
  energy: 1,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-270.webp",
  text: "Buff a friendly unit in your base, then move it to a battlefield. (If it doesn't have a buff, it gets a +1 Might buff.)",
  effects: [
    { timing: "spell", kind: "showstopper" }
  ]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-264",
  collectorNumber: "OGN-264/298",
  name: "Guerilla Warfare",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.MIND, DOMAINS.CHAOS],
  tags: ["Signature", "Signature Spell", "Teemo"],
  keywords: ["Hidden"],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-264.webp",
  text: "Return up to two cards with HIDDEN from your trash to your hand. You can hide ignoring costs this turn.",
  effects: [
    {
      timing: "spell",
      kind: "returnHiddenTrashToHand",
      amount: 2
    }
  ]
});

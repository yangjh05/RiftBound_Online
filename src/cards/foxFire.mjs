import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-256",
  collectorNumber: "OGN-256/298",
  name: "Fox-Fire",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM, DOMAINS.MIND],
  tags: ["Signature", "Signature Spell", "Ahri", "Action"],
  keywords: ["Hidden"],
  energy: 3,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-256.webp",
  text: "HIDDEN (Hide now for Rune to react with later for 0.)\nACTION (Play on your turn or in showdowns.)\nKill any number of units at a battlefield with total Might 4 or less.",
  effects: [
    {
      timing: "spell",
      kind: "killBattlefieldUnitsTotalMightMax",
      maxMight: 4
    }
  ]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-238a",
  collectorNumber: "OGN-238a/298",
  name: "Leona, Determined",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.ORDER],
  tags: ["Champion","Leona","Mount Targon"],
  keywords: ["Shield"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-238a.webp",
  text: "SHIELD (+1 Might while I'm a defender.)\nWhen I attack, stun an enemy unit here.\n(It doesn't deal combat damage this turn.)",
  effects: [
      {
          "timing": "attackOrDefend",
          "kind": "stunEnemyHere",
          "role": "attacker"
      }
  ]
});

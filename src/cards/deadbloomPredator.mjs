import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-161",
  collectorNumber: "OGN-161/298",
  name: "Deadbloom Predator",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY],
  tags: ["Shadow Isles"],
  keywords: ["Deflect"],
  energy: 8,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  might: 8,
  image: "https://cdn.piltoverarchive.com/cards/OGN-161.webp",
  text: "DEFLECT (Opponents must play Rune to choose me with a spell or effect.)\nYou may play me to an occupied enemy battlefield.",
  effects: [
      {
          "timing": "static",
          "kind": "canEnterEnemyBattlefield"
      }
  ]
});

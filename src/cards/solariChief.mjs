import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-225",
  collectorNumber: "OGN-225/298",
  name: "Solari Chief",
  type: "unit",
  set: "Origins",
  rarity: "Uncommon",
  domains: [DOMAINS.ORDER],
  tags: ["Mount Targon"],
  keywords: [],
  energy: 5,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  image: "https://cdn.piltoverarchive.com/cards/OGN-225.webp",
  text: "When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it. (it doesn't deal combat damage this turn.)",
  effects: [
    { timing: "onPlay", kind: "stunOrKillEnemy" }
  ]
});

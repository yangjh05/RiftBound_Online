import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-268",
  collectorNumber: "OGN-268/298",
  name: "Bullet Time",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.BODY, DOMAINS.CHAOS],
  tags: ["Signature Spell","Miss Fortune","Action"],
  keywords: [],
  energy: 1,
  power: [],
  image: "https://cdn.piltoverarchive.com/cards/OGN-268.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nPay any amount of Rune to deal that much damage to all enemy units at a battlefield.",
  effects: [
    {
      timing: "spell",
      kind: "damageEnemyUnitsAtBattlefieldByReadyRunes"
    }
  ]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-174",
  collectorNumber: "OGN-174/298",
  name: "Sai Scout",
  type: "unit",
  set: "Origins",
  rarity: "Common",
  domains: [DOMAINS.CHAOS],
  tags: ["Shurima"],
  keywords: ["Vision"],
  energy: 6,
  power: [],
  might: 5,
  image: "https://cdn.piltoverarchive.com/cards/OGN-174.webp",
  text: "VISION (When you play me, look at the top card of your Main Deck. You may recycle it.)\nYou may play me to an open battlefield.",
  effects: [
    {
      timing: "static",
      kind: "canEnterOpenBattlefield"
    }
  ]
});

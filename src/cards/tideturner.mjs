import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-199",
  collectorNumber: "OGN-199/298",
  name: "Tideturner",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Bilgewater","Hidden"],
  keywords: ["Hidden"],
  energy: 2,
  power: [],
  might: 2,
  image: "https://exburst.dev/riftbound/cards/sd/OGN-199-298.webp",
  text: "[Hidden] (Hide now for Power to react with later for Energy 0.)\nWhen you play me, you may choose a unit you control at another location. Move me to its location and it to my original location.",
  effects: [
  {
    "timing": "onPlay",
    "kind": "swapWithControlledUnit",
    "optional": true,
    "differentLocation": true
  }
]
});

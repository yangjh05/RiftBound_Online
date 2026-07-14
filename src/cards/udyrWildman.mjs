import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-157",
  collectorNumber: "OGN-157/298",
  name: "Udyr, Wildman",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.BODY],
  tags: ["Champion","Udyr","Freljord"],
  keywords: ["Ganking"],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-157.webp",
  text: "Spend my buff: Choose one you've not chosen turn --\nDeal 2 to a unit at a battlefield.\nStun a unit at a battlefield\nReady me.\nGive me GANKING this turn.",
  effects: [{ timing: "activated", kind: "udyrChooseMode", exhaust: false }]
});

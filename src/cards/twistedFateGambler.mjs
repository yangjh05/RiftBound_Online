import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-200",
  collectorNumber: "OGN-200/298",
  name: "Twisted Fate, Gambler",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.CHAOS],
  tags: ["Champion","Twisted Fate","Bilgewater"],
  keywords: [],
  energy: 4,
  power: [],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-200.webp",
  text: "When I attack, reveal the top rune of your rune deck, then recycle it. Do one of the following based on its domain:\nFury - Deal 2 to an enemy unit here and 1 to all other enemy units here.\nMind - Draw 1.\nOrder - Stun an enemy unit.",
  effects: [{ timing: "attackOrDefend", role: "attacker", kind: "runeDeckGambit" }]
});

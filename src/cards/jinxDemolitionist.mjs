import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-030",
  collectorNumber: "OGN-030/298",
  name: "Jinx, Demolitionist",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Jinx","Zaun"],
  keywords: ["Accelerate","Assault"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 4,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-030.webp",
  text: "ACCELERATE (You may pay 1 Fury as an additional cost to have me enter ready.)\n[ASSAULT 2] (+2 Might while I'm an attacker.)\nWhen you play me, discard 2.",
  effects: [
      {
          "timing": "onPlay",
          "kind": "discard",
          "amount": 2
      }
  ]
});

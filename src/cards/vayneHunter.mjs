import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-035",
  collectorNumber: "OGN-035/298",
  name: "Vayne, Hunter",
  type: "unit",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.FURY],
  tags: ["Champion","Vayne","Demacia"],
  keywords: ["Assault"],
  energy: 4,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 2,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-035.webp",
  text: "[ASSAULT 3] (+3 Might while I'm an attacker.)\nIf an opponent controls a battlefield, I enter ready.\nWhen I conquer, you may pay 1 to return me to my owner's hand.",
  effects: [
      {
          "timing": "static",
          "kind": "enterReadyIfOpponentControlsBattlefield"
      },
      {
          "timing": "conquer",
          "kind": "payEnergyReturnSelfToHand",
          "amount": 1,
          "optional": true
      }
  ]
});

import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-112a",
  collectorNumber: "OGN-112a/298",
  name: "Kai'Sa, Evolutionary",
  type: "unit",
  set: "Origins",
  rarity: "Showcase",
  domains: [DOMAINS.MIND],
  tags: ["Champion","Kai'Sa","The Void"],
  keywords: ["Ganking"],
  energy: 6,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 6,
  isChampion: true,
  image: "https://cdn.piltoverarchive.com/cards/OGN-112a.webp",
  text: "GANKING (I can move from battlefield to battlefield.)\nWhen I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it. (You must still pay its Power cost.)",
  effects: [
    {
      timing: "conquer",
      kind: "playSpellFromTrashMaxEnergy",
      maxEnergyFromPoints: true,
      lessThanPoints: true,
      optional: true
    }
  ]
});

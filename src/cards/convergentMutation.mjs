import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-108",
  collectorNumber: "OGN-108/298",
  name: "Convergent Mutation",
  type: "spell",
  set: "Origins",
  rarity: "Rare",
  domains: [DOMAINS.MIND],
  tags: ["Reaction"],
  keywords: [],
  energy: 2,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-108.webp",
  text: "𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 - 𝗙𝗿𝗼𝗺 𝗢𝗿𝗶𝗴𝗶𝗻𝘀 𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮:\nReaction (Play any time, even before spells and abilities\nresolve.)\nChoose a friendly unit. This turn, increase its Might to the\nMight of another friendly unit.",
  effects: [
    {
      timing: "spell",
      kind: "matchFriendlyMight",
      temporary: true
    }
  ]
});

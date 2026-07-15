import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-260",
  collectorNumber: "OGN-260/298",
  name: "Last Breath",
  type: "spell",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.CALM, DOMAINS.CHAOS],
  tags: ["Signature", "Signature Spell", "Yasuo", "Action"],
  keywords: [],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 2 }],
  image: "https://cdn.piltoverarchive.com/cards/OGN-260.webp",
  text: "ACTION (Play on your turn or in showdowns.)\nReady a friendly unit. It deals damage equal to its Might to an enemy at a battlefield.",
  effects: [
    { timing: "spell", kind: "lastBreath" }
  ]
});

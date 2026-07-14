import { card, DOMAINS } from "./shared.mjs";

export default card({
  id: "OGN-037",
  collectorNumber: "OGN-037/298",
  name: "Immortal Phoenix",
  type: "unit",
  set: "Origins",
  rarity: "Epic",
  domains: [DOMAINS.FURY],
  tags: ["Spirit"],
  keywords: ["Assault"],
  energy: 3,
  power: [{ domain: DOMAINS.ANY, amount: 1 }],
  might: 3,
  image: "https://cdn.piltoverarchive.com/cards/OGN-037.webp",
  text: "[ASSAULT 2] (+2 Might while I'm an attacker.)\nWhen you kill a unit with a spell, you may pay 1 Fury to play me from your trash.",
  effects: [{ timing: "static", kind: "playSelfFromTrashWhenSpellKillsUnit", domain: DOMAINS.FURY }]
});

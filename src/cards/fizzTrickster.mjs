import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-140",
      "collectorNumber": "SFD-140/221",
      "name": "Fizz, Trickster",
      "type": "unit",
      "isChampion": true,
      "set": "Spiritforged",
      "rarity": "Rare",
      "domains": [
        DOMAINS.CHAOS
      ],
      "tags": [
        "Champion",
        "Yordle",
        "Fizz",
        "Bilgewater"
      ],
      "keywords": [],
      "energy": 3,
      "power": [
        {
          "domain": DOMAINS.ANY,
          "amount": 1
        }
      ],
      "might": 3,
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-140-221.webp",
      "text": "When you play me, you may play a spell from your trash with Energy cost no more than Energy 3, ignoring its Energy cost. Recycle that spell after you play it. (You must still pay its Power cost.)",
      "effects": [
        {
          "timing": "onPlay",
          "kind": "playSpellFromTrashMaxEnergy",
          "maxEnergy": 3,
          "optional": true
        }
      ]
    });

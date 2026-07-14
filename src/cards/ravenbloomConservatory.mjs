import { card, DOMAINS } from "./shared.mjs";

export default card({
      "id": "SFD-215",
      "collectorNumber": "SFD-215/221",
      "name": "Ravenbloom Conservatory",
      "type": "battlefield",
      "set": "Spiritforged",
      "rarity": "Uncommon",
      "domains": [],
      "tags": [],
      "keywords": [],
      "power": [],
      "image": "https://exburst.dev/riftbound/cards/sd/SFD-215-221.webp",
      "text": "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.",
      "effects": [
        {
          "timing": "defendHere",
          "kind": "revealTopSpellToHandElseRecycle"
        }
      ]
    });

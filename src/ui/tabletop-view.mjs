function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

export function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function safeCount(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.trunc(number));
}

function normalizedPoolResources(value, kind) {
  if (kind === "energy" && Number.isFinite(Number(value)) && !Array.isArray(value)) {
    return Array.from({ length: safeCount(value) }, (_, index) => ({
      id: `legacy-energy-${index}`,
      restriction: null
    }));
  }

  return asList(value).map((resource, index) => {
    if (resource && typeof resource === "object") return resource;
    if (kind === "power" && typeof resource === "string") {
      return {
        id: `legacy-power-${index}`,
        domain: resource,
        restriction: null
      };
    }
    return {
      id: `legacy-${kind}-${index}`,
      restriction: null
    };
  });
}

function resourceAvailability(resources, usablePredicate) {
  const predicate = typeof usablePredicate === "function"
    ? usablePredicate
    : (resource) => !resource?.restriction;
  let usable = 0;

  for (const [index, resource] of resources.entries()) {
    try {
      if (predicate(resource, index)) usable += 1;
    } catch {
      // A presentation predicate must not make an otherwise renderable seat fail.
    }
  }

  return {
    usable,
    total: resources.length
  };
}

export function tabletopSeatView(player, {
  side = "bottom",
  visibleHandCount,
  revealHand = false,
  energyUsable,
  powerUsable
} = {}) {
  const source = asObject(player);
  const hand = asList(source.hand);
  const mainDeck = asList(source.mainDeck);
  const runeDeck = asList(source.runeDeck);
  const runes = asList(source.runes);
  const trash = asList(source.trash);
  const banished = asList(source.banished);
  const base = asList(source.base);
  const runePool = asObject(source.runePool);
  const poolEnergy = normalizedPoolResources(runePool.energy, "energy");
  const poolPower = normalizedPoolResources(runePool.power, "power");
  const publicHandCount = safeCount(visibleHandCount, hand.length);

  return {
    player: source,
    id: String(source.id ?? ""),
    side: side === "top" ? "top" : "bottom",
    legend: source.legend && typeof source.legend === "object" ? source.legend : null,
    champion: source.champion && typeof source.champion === "object" ? source.champion : null,
    hand,
    visibleHandCards: revealHand ? hand.filter((card) => !card.redacted) : [],
    mainDeck,
    runeDeck,
    runes,
    trash,
    banished,
    base,
    runeResources: {
      energy: resourceAvailability(poolEnergy, energyUsable),
      power: resourceAvailability(poolPower, powerUsable)
    },
    counts: {
      hand: publicHandCount,
      mainDeck: mainDeck.length,
      runeDeck: runeDeck.length,
      runes: runes.length,
      trash: trash.length,
      banished: banished.length,
      base: base.length
    },
    xp: safeCount(source.xp),
    burnOuts: safeCount(source.burnOuts)
  };
}

export function fanCardStyle(index, total, {
  maxAngle = 24,
  maxRise = 18,
  reverse = false
} = {}) {
  const count = Math.max(1, safeCount(total, 1));
  const safeIndex = Math.min(Math.max(0, safeCount(index)), count - 1);
  const midpoint = (count - 1) / 2;
  const normalized = midpoint ? (safeIndex - midpoint) / midpoint : 0;
  const direction = reverse ? -1 : 1;
  const angle = normalized * Math.max(0, Number(maxAngle) || 0) * direction;
  const rise = Math.pow(Math.abs(normalized), 1.65) * Math.max(0, Number(maxRise) || 0);
  return `--fan-index:${safeIndex};--fan-count:${count};--fan-angle:${angle.toFixed(2)}deg;--fan-rise:${rise.toFixed(2)}px`;
}

export function topDiscardCard(cards) {
  const list = asList(cards);
  return list.at(-1) || null;
}

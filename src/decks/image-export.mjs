import { RUNE_COLORS } from "../cards/shared.mjs";
import { translateCardName, translateDomain } from "../i18n.mjs";
import { championMatchesLegend } from "../rules/champions.mjs";

const WIDTH = 2000;
const MARGIN = 48;
const GAP = 10;
const COLUMNS = 10;
const CARD_WIDTH = (WIDTH - MARGIN * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
const CARD_HEIGHT = CARD_WIDTH * 2079 / 1488;
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif';
const GOLD = "#d5b879";
const DOMAIN_ORDER = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order", "Any"];
const TYPE_ORDER = ["unit", "gear", "spell"];
export const DECK_IMAGE_SORT_OPTIONS = [
  { id: "type", ko: "종류 → 코스트 → 색상", en: "Type → Cost → Domain" },
  { id: "cost", ko: "코스트 → 종류 → 색상", en: "Cost → Type → Domain" },
  { id: "domain", ko: "색상 → 종류 → 코스트", en: "Domain → Type → Cost" }
];
const RUNE_ICONS = {
  Fury: new URL("../../assets/runes/fury.png", import.meta.url).href,
  Calm: new URL("../../assets/runes/calm.png", import.meta.url).href,
  Mind: new URL("../../assets/runes/mind.png", import.meta.url).href,
  Body: new URL("../../assets/runes/body.png", import.meta.url).href,
  Chaos: new URL("../../assets/runes/chaos.png", import.meta.url).href,
  Order: new URL("../../assets/runes/order.png", import.meta.url).href
};

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function domainKey(card) {
  return [...new Set(card.domains?.length ? card.domains : [card.domain || "Any"])]
    .map((domain) => DOMAIN_ORDER.indexOf(domain)).map((rank) => rank < 0 ? DOMAIN_ORDER.length : rank)
    .sort((a, b) => a - b).join("");
}

// Sort a copy: exporting must not change the saved deck or split identical copies.
export function sortDeckImageCards(cards, sort = "type") {
  const typeRank = (card) => { const rank = TYPE_ORDER.indexOf(card.type); return rank < 0 ? TYPE_ORDER.length : rank; };
  const powerCost = (card) => (card.power || []).reduce((sum, power) => sum + (Number(power.amount) || 0), 0);
  const comparisons = {
    type: (a, b) => typeRank(a) - typeRank(b),
    cost: (a, b) => (Number(a.energy) || 0) - (Number(b.energy) || 0) || powerCost(a) - powerCost(b),
    domain: (a, b) => compareText(domainKey(a), domainKey(b))
  };
  const priorities = sort === "cost" ? ["cost", "type", "domain"] : sort === "domain" ? ["domain", "type", "cost"] : ["type", "cost", "domain"];
  return [...cards].sort((a, b) => {
    for (const key of priorities) { const result = comparisons[key](a, b); if (result) return result; }
    return compareText(a.name || "", b.name || "") || compareText(a.cardNumber || "", b.cardNumber || "");
  });
}

export function deckImageChampionCandidates(deck, { cardByNumber }) {
  const legend = cardByNumber(deck.legend);
  return [...new Map((deck.main || [])
    .filter(([, count]) => Number.isInteger(count) && count > 0)
    .map(([number]) => cardByNumber(number))
    .filter((card) => card?.type === "unit" && championMatchesLegend(card, legend))
    .map((card) => [card.cardNumber, card])).values()];
}

// A deck record already includes its Champion in main. Move one copy, never add another.
export function deckImageModel(deck, { cardByNumber, runeByKey, locale = "ko", sort = "type", championFirst = false, championNumber = "" }) {
  const resolve = (number) => {
    const card = cardByNumber(number);
    if (!card) throw new Error(locale === "ko" ? `카드를 찾을 수 없습니다: ${number}` : `Unknown card: ${number}`);
    return card;
  };
  const expand = (entries = []) => {
    const result = [];
    for (const [number, count] of entries) {
      if (!Number.isInteger(count) || count < 1 || result.length + count > 200) {
        throw new Error(locale === "ko" ? "이미지로 내보낼 카드 수를 확인해 주세요. (영역당 최대 200장)" : "Check the card counts (up to 200 per section).");
      }
      result.push(...Array(count).fill(resolve(number)));
    }
    return result;
  };
  const runesByName = new Map();
  for (const [key, count] of deck.runes || []) {
    const card = runeByKey(key);
    if (card?.type !== "rune" || !Number.isInteger(count) || count < 1) throw new Error(locale === "ko" ? "룬 구성을 확인해 주세요." : "Check the Rune configuration.");
    const existing = runesByName.get(card.name);
    if (existing) existing.count += count;
    else runesByName.set(card.name, { card, count });
  }
  const runes = [...runesByName.values()].sort((a, b) => compareText(domainKey(a.card), domainKey(b.card)) || compareText(a.card.name, b.card.name));
  const battlefields = (deck.battlefields || []).map(resolve);
  if (battlefields.length > 12) throw new Error(locale === "ko" ? "전장 수를 확인해 주세요." : "Check the Battlefield count.");
  const main = sortDeckImageCards(expand(deck.main), sort);
  if (championFirst) {
    const candidates = deckImageChampionCandidates(deck, { cardByNumber });
    const selected = championNumber ? candidates.find((card) => card.cardNumber === championNumber) : candidates.length === 1 ? candidates[0] : null;
    if ((championNumber && !selected) || (candidates.length > 1 && !selected)) {
      throw new Error(locale === "ko" ? "맨 앞에 표시할 챔피언을 선택해 주세요." : "Choose the Champion to show first.");
    }
    if (selected) main.unshift(...main.splice(main.findIndex((card) => card.cardNumber === selected.cardNumber), 1));
  }
  return {
    name: deck.name || (locale === "ko" ? "이름 없는 덱" : "Untitled deck"),
    locale,
    legend: deck.legend ? resolve(deck.legend) : null,
    battlefields,
    main,
    sideboard: sortDeckImageCards(expand(deck.sideboard), sort),
    runes,
    runeCount: runes.reduce((sum, entry) => sum + entry.count, 0)
  };
}

export function deckImageFilename(name = "deck") {
  const safe = String(name).normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").replace(/[.\s]+$/gu, "").trim().slice(0, 80) || "deck";
  return `Riftbound-${safe}.png`;
}

export function deckImageLayout(model) {
  const headerHeight = 232 + Math.max(1, Math.ceil(model.battlefields.length / 3)) * 286;
  let y = headerHeight;
  const sections = [
    { key: "main", cards: model.main, title: model.locale === "ko" ? "메인 덱" : "MAIN DECK" },
    { key: "sideboard", cards: model.sideboard, title: model.locale === "ko" ? "사이드보드" : "SIDEBOARD" }
  ].map((section) => {
    const height = 64 + (section.cards.length ? Math.ceil(section.cards.length / COLUMNS) * (CARD_HEIGHT + GAP) : 64) + 24;
    const result = { ...section, y, height };
    y += height;
    return result;
  });
  const runeHeight = 104 + Math.max(1, Math.ceil(model.runes.length / 4)) * 64;
  return { width: WIDTH, height: Math.ceil(y + runeHeight + 100), sections, runeY: y, runeHeight };
}

export async function renderDeckImage(model, { imageUrl, signal, onProgress = () => {} }) {
  const uniqueCards = [...new Map([
    model.legend, ...model.battlefields, ...model.main, ...model.sideboard
  ].filter(Boolean).map((card) => [card.cardNumber, card])).values()];
  const images = new Map();
  const missing = [];
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: Math.min(4, uniqueCards.length) }, async () => {
    while (cursor < uniqueCards.length) {
      signal?.throwIfAborted();
      const card = uniqueCards[cursor++];
      try {
        images.set(card.cardNumber, await loadImage(imageUrl(card), signal));
      } catch (error) {
        signal?.throwIfAborted();
        missing.push(card);
      }
      onProgress(++completed, uniqueCards.length);
    }
  }));
  const runeIcons = new Map();
  await Promise.all([...new Set(model.runes.map(({ card }) => card.domains?.[0] || card.domain))].map(async (domain) => {
    if (!RUNE_ICONS[domain]) throw new Error(model.locale === "ko" ? "룬 아이콘을 찾을 수 없습니다." : "Rune icon unavailable.");
    runeIcons.set(domain, await loadImage(RUNE_ICONS[domain], signal));
  }));
  signal?.throwIfAborted();
  await document.fonts?.ready;
  const layout = deckImageLayout(model);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(model.locale === "ko" ? "이미지를 만들 수 없습니다." : "Image rendering is unavailable.");
  ctx.imageSmoothingQuality = "high";
  drawDeck(ctx, model, layout, images, runeIcons);
  try {
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
    return { blob, width: canvas.width, height: canvas.height, missing };
  } finally {
    canvas.width = canvas.height = 0;
    images.clear();
  }
}

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error) => { cleanup(); img.src = ""; reject(error); };
    const abort = () => fail(signal.reason || new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => fail(new Error("Card image unavailable"));
    timer = setTimeout(() => fail(new Error("Card image timed out")), 20000);
    img.src = url;
  });
}

function label(ctx, text, x, y, size, color = "#f4f0e5", maxWidth, weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = "middle";
  let display = String(text);
  if (maxWidth && ctx.measureText(display).width > maxWidth) {
    while (display.length && ctx.measureText(`${display}…`).width > maxWidth) display = display.slice(0, -1);
    display += "…";
  }
  ctx.fillText(display, x, y);
}

function rule(ctx, y, x = MARGIN, width = WIDTH - MARGIN * 2) {
  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  gradient.addColorStop(0, GOLD);
  gradient.addColorStop(1, "#273d49");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, 1);
}

function sectionHeading(ctx, title, count, x, y, width, korean) {
  ctx.fillStyle = GOLD;
  ctx.save();
  ctx.translate(x + 7, y + 23);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();
  label(ctx, title, x + 28, y + 24, 25, GOLD);
  ctx.textAlign = "right";
  label(ctx, korean ? `${count}장` : `${count} CARDS`, x + width, y + 24, 20, "#aebfc5");
  ctx.textAlign = "left";
  rule(ctx, y + 48, x, width);
}

function drawCard(ctx, card, images, x, y, width, height, locale) {
  ctx.fillStyle = "#030a10";
  ctx.fillRect(x, y, width, height);
  const img = images.get(card.cardNumber);
  if (img) {
    const rotate = card.type === "battlefield" && img.naturalHeight > img.naturalWidth;
    const naturalWidth = rotate ? img.naturalHeight : img.naturalWidth;
    const naturalHeight = rotate ? img.naturalWidth : img.naturalHeight;
    const scale = Math.min(width / naturalWidth, height / naturalHeight);
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    if (rotate) ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2, img.naturalWidth * scale, img.naturalHeight * scale);
    ctx.restore();
  } else {
    ctx.strokeStyle = "#756344";
    ctx.strokeRect(x + 8, y + 8, width - 16, height - 16);
    label(ctx, translateCardName(card, locale), x + 16, y + height / 2 - 26, 18, GOLD, width - 32);
    label(ctx, card.cardNumber, x + 16, y + height / 2 + 10, 15, "#aebfc5", width - 32);
    label(ctx, locale === "ko" ? "이미지 없음" : "Image unavailable", x + 16, y + height / 2 + 44, 15, "#aebfc5", width - 32);
  }
}

function drawDeck(ctx, model, layout, images, runeIcons) {
  const korean = model.locale === "ko";
  const background = ctx.createLinearGradient(0, 0, WIDTH, layout.height);
  background.addColorStop(0, "#102c3c");
  background.addColorStop(0.45, "#081924");
  background.addColorStop(1, "#050e18");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, layout.height);
  // Restrained angular framing leaves the full card faces unobscured.
  ctx.strokeStyle = "#344848";
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, WIDTH - 40, layout.height - 40);
  const domains = model.legend?.domains || [];
  (domains.length ? domains : ["Any"]).forEach((domain, index, all) => {
    ctx.fillStyle = RUNE_COLORS[domain] || GOLD;
    ctx.fillRect(MARGIN + index * (WIDTH - MARGIN * 2) / all.length, 0, (WIDTH - MARGIN * 2) / all.length, 6);
  });
  label(ctx, "RIFTBOUND", MARGIN, 64, 29, GOLD, undefined, 800);
  label(ctx, "ONLINE  /  DECK COLLECTION", MARGIN + 222, 65, 16, "#95afb9");
  ctx.textAlign = "right";
  label(ctx, domains.map((domain) => translateDomain(domain, model.locale)).join("  /  "), WIDTH - MARGIN, 65, 22, GOLD);
  ctx.textAlign = "left";
  label(ctx, model.name, MARGIN, 129, 48, "#fbf5e8", WIDTH - MARGIN * 2, 700);
  label(ctx, korean
    ? `메인 덱 ${model.main.length}  ·  룬 ${model.runeCount}  ·  전장 ${model.battlefields.length}  ·  사이드보드 ${model.sideboard.length}`
    : `MAIN ${model.main.length}  ·  RUNES ${model.runeCount}  ·  BATTLEFIELDS ${model.battlefields.length}  ·  SIDEBOARD ${model.sideboard.length}`,
  MARGIN, 186, 22, "#aebfc5");
  rule(ctx, 220);

  const fieldX = 748;
  const fieldWidth = (WIDTH - MARGIN - fieldX - 2 * GAP) / 3;
  sectionHeading(ctx, korean ? "레전드" : "LEGEND", model.legend ? 1 : 0, MARGIN, 232, 644, korean);
  if (model.legend) {
    drawCard(ctx, model.legend, images, MARGIN, 294, 150, 210, model.locale);
    label(ctx, translateCardName(model.legend, model.locale), 226, 375, 27, "#fbf5e8", 466);
    label(ctx, model.legend.cardNumber, 226, 419, 19, "#95afb9");
  }
  sectionHeading(ctx, korean ? "전장" : "BATTLEFIELDS", model.battlefields.length, fieldX, 232, WIDTH - MARGIN - fieldX, korean);
  model.battlefields.forEach((card, index) => {
    drawCard(ctx, card, images, fieldX + (index % 3) * (fieldWidth + GAP), 294 + Math.floor(index / 3) * 286, fieldWidth, 210, model.locale);
  });

  for (const section of layout.sections) {
    sectionHeading(ctx, section.title, section.cards.length, MARGIN, section.y, WIDTH - MARGIN * 2, korean);
    section.cards.forEach((card, index) => {
      drawCard(ctx, card, images, MARGIN + (index % COLUMNS) * (CARD_WIDTH + GAP), section.y + 64 + Math.floor(index / COLUMNS) * (CARD_HEIGHT + GAP), CARD_WIDTH, CARD_HEIGHT, model.locale);
    });
    if (!section.cards.length) label(ctx, korean ? "등록된 카드가 없습니다" : "No cards registered", MARGIN, section.y + 108, 24, "#95afb9");
  }
  sectionHeading(ctx, korean ? "룬 덱" : "RUNE DECK", model.runeCount, MARGIN, layout.runeY, WIDTH - MARGIN * 2, korean);
  model.runes.forEach(({ card, count }, index) => {
    const x = MARGIN + (index % 4) * 480;
    const y = layout.runeY + 92 + Math.floor(index / 4) * 64;
    const icon = runeIcons.get(card.domains?.[0] || card.domain);
    ctx.drawImage(icon, x, y - 24, 48, 48);
    label(ctx, translateCardName(card, model.locale), x + 64, y, 23, "#e0e8e6", 310);
    label(ctx, `× ${count}`, x + 388, y, 27, GOLD);
  });
  if (!model.runes.length) label(ctx, korean ? "등록된 룬이 없습니다" : "No Runes registered", MARGIN, layout.runeY + 92, 23, "#95afb9");
  rule(ctx, layout.height - 86);
  label(ctx, "RIFTBOUND ONLINE", MARGIN, layout.height - 53, 18, GOLD);
  ctx.textAlign = "right";
  label(ctx, korean ? "카드 이미지 © Riot Games" : "Card images © Riot Games", WIDTH - MARGIN, layout.height - 53, 17, "#829aa5");
  ctx.textAlign = "left";
}

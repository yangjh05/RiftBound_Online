// Lossless text extraction: only HTML layout and printed resource symbols change.
export const KOREAN_DOMAINS = Object.freeze({
  Body: "신체", Calm: "평정", Chaos: "혼돈", Fury: "분노", Mind: "정신", Order: "질서"
});

export function galleryText(html = "") {
  return String(html)
    .replace(/<br\s*\/?>|<\/p>|<\/li>/giu, "\n")
    .replace(/<li(?:\s[^>]*)?>/giu, "• ")
    .replace(/<[^>]+>/gu, "")
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gu, (entity) => ({
      "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " "
    })[entity])
    .replace(/&#(x[\da-f]+|\d+);/giu, (_, code) => String.fromCodePoint(
      code.startsWith("x") ? parseInt(code.slice(1), 16) : Number(code)
    ))
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function koreanGalleryText(html = "") {
  return galleryText(html).replace(/((?::rb_[a-z_0-9]+:)+)(을|를)?/gu, (_, run, particle) => {
    const symbols = run.match(/:rb_[a-z_0-9]+:/gu);
    const withParticle = (text) => text + (particle ? (/[2459]$/u.test(text) ? "를" : "을") : "");
    if (symbols.every((symbol) => symbol === ":rb_rune_rainbow:")) {
      return withParticle(`힘 ${symbols.length}`);
    }
    return withParticle(symbols.map((symbol) => {
      if (symbol === ":rb_might:") return "위력";
      if (symbol === ":rb_exhaust:") return "탈진";
      const energy = symbol.match(/^:rb_energy_(\d+):$/u);
      if (energy) return `에너지 ${energy[1]}`;
      const domain = symbol.match(/^:rb_rune_(body|calm|chaos|fury|mind|order):$/u)?.[1];
      if (domain) return `${KOREAN_DOMAINS[domain[0].toUpperCase() + domain.slice(1)]} 힘 1`;
      throw new Error(`Unknown official card symbol: ${symbol}`);
    }).join(" + "));
  }).replace(/탈진:/gu, "이 카드를 탈진:");
}

// The local collector-number convention uses s for signature and includes seven
// extra art variants absent from the official gallery. Only these aliases inherit.
export function officialKoreanSourceNumber(number) {
  if (/^OGN-3(?:0[0-9]|10)s\/298$/u.test(number) || number === "OGN-299s/298") {
    return number.replace("s/", "*/");
  }
  if (/^OGN-(?:007|042|089|126|166|197|214)b\/298$/u.test(number)) {
    return number.replace("b/", "/");
  }
  return number;
}

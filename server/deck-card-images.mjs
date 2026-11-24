import { cards } from "../src/cards.mjs";
import { translateCardImage } from "../src/i18n.mjs";
import { securityHeaders } from "./http-security.mjs";

const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
const IMAGE_ORIGINS = new Set(["https://cmsassets.rgpub.io", "https://exburst.dev", "https://cdn.piltoverarchive.com", "https://static.dotgg.gg"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

export function deckCardImageSource(number, locale) {
  const card = CARD_BY_NUMBER.get(number);
  if (!card) return null;
  const source = translateCardImage(card, locale === "ko" ? "ko" : "en");
  if (!source) return null;
  const url = new URL(source);
  if (!IMAGE_ORIGINS.has(url.origin)) return null;
  if (url.hostname === "cmsassets.rgpub.io") {
    url.searchParams.set("w", "640");
    url.searchParams.set("auto", "format");
  }
  return url.href;
}

// Only registered card IDs are accepted, never caller-supplied upstream URLs.
// This also makes official Korean art usable in an origin-clean export canvas.
export function createDeckCardImageHandler({ fetchImage = fetch } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0;
  const read = async (source) => {
    const response = await fetchImage(source, { redirect: "error", signal: AbortSignal.timeout(12000) });
    const type = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(type)) throw new Error("Invalid card image");
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new Error("Card image too large");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) throw new Error("Card image too large");
      chunks.push(chunk);
    }
    if (!size) throw new Error("Empty card image");
    const result = { body: Buffer.concat(chunks), type };
    while (cache.size >= 128 || cacheBytes + size > MAX_CACHE_BYTES) {
      const first = cache.keys().next().value;
      cacheBytes -= cache.get(first).body.length;
      cache.delete(first);
    }
    cache.set(source, result);
    cacheBytes += size;
    return result;
  };
  return async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== "/api/deck-card-image") return false;
    const send = (status, body, extra = {}) => {
      res.writeHead(status, securityHeaders({ "access-control-allow-origin": "*", "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra }));
      res.end(body);
      return true;
    };
    if (req.method !== "GET") return send(405, "Method not allowed", { allow: "GET" });
    const source = deckCardImageSource(url.searchParams.get("card"), url.searchParams.get("locale"));
    if (!source) return send(404, "Card image not found");
    if (!cache.has(source) && !pending.has(source) && pending.size >= 8) return send(503, "Image service busy", { "retry-after": "2" });
    try {
      if (!cache.has(source) && !pending.has(source)) {
        pending.set(source, read(source).finally(() => pending.delete(source)));
      }
      const image = cache.get(source) || await pending.get(source);
      return send(200, image.body, { "content-type": image.type, "content-length": image.body.length, "cache-control": "public, max-age=86400" });
    } catch {
      return send(502, "Card image unavailable");
    }
  };
}

export const handleDeckCardImageRequest = createDeckCardImageHandler();

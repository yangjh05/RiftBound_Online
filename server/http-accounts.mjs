import { AccountError, accountStore, bearerToken } from "./accounts.mjs";

export async function handleAccountRequest(req, res, helpers) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/account/decks") return false;

  try {
    if (req.method === "POST" && url.pathname === "/api/auth/signup") {
      const body = await helpers.readJson(req);
      return helpers.json(res, 201, { ok: true, ...await accountStore.signUp(body.accountId, body.password) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await helpers.readJson(req);
      return helpers.json(res, 200, { ok: true, ...await accountStore.login(body.accountId, body.password) });
    }
    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      return helpers.json(res, 200, { ok: true, ...await accountStore.account(bearerToken(req)) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      accountStore.logout(bearerToken(req));
      return helpers.json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/account/decks") {
      const account = await accountStore.account(bearerToken(req));
      return helpers.json(res, 200, { ok: true, deckStore: account.deckStore });
    }
    if (req.method === "PUT" && url.pathname === "/api/account/decks") {
      const body = await helpers.readJson(req);
      const deckStore = await accountStore.saveDeckStore(bearerToken(req), body.deckStore);
      return helpers.json(res, 200, { ok: true, deckStore });
    }
    return helpers.json(res, 405, { ok: false, message: "Method not allowed." });
  } catch (error) {
    const status = error instanceof AccountError ? error.status : 500;
    return helpers.json(res, status, {
      ok: false,
      code: error instanceof AccountError ? error.code : "server_error",
      message: error?.message || "Server error."
    });
  }
}

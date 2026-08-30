import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cardByNumber, normalizeSubmittedDeck } from "./decks.mjs";

const scrypt = promisify(scryptCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_FILE = process.env.RIFTBOUND_ACCOUNT_DATA_FILE
  ? path.resolve(process.env.RIFTBOUND_ACCOUNT_DATA_FILE)
  : path.join(projectRoot, "data", "accounts.json");
const ACCOUNT_ID_PATTERN = /^[\p{L}\p{N}_.-]{3,24}$/u;
const PERSONAL_DECK_ID_PATTERN = /^deck-[A-Za-z0-9._-]{1,90}$/u;
const MAX_DECKS_PER_ACCOUNT = 100;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export class AccountError extends Error {
  constructor(message, status = 400, code = "account_error") {
    super(message);
    this.name = "AccountError";
    this.status = status;
    this.code = code;
  }
}

export class AccountStore {
  constructor(options = {}) {
    this.filePath = path.resolve(options.filePath || DEFAULT_DATA_FILE);
    this.sessions = new Map();
    this.writeQueue = Promise.resolve();
  }

  async signUp(rawAccountId, rawPassword) {
    const accountId = normalizeAccountId(rawAccountId);
    const accountKey = accountId.toLocaleLowerCase("en-US");
    const password = normalizePassword(rawPassword);
    const passwordRecord = await createPasswordRecord(password);
    const now = Date.now();
    const user = await this.mutate(async (database) => {
      if (database.users[accountKey]) {
        throw new AccountError("That account ID is already in use.", 409, "account_exists");
      }
      const created = {
        id: randomUUID(),
        accountId,
        accountKey,
        password: passwordRecord,
        decks: [],
        activeDeckIds: [],
        createdAt: now,
        updatedAt: now
      };
      database.users[accountKey] = created;
      return created;
    });
    return this.createAuthenticatedResult(user);
  }

  async login(rawAccountId, rawPassword) {
    const accountId = normalizeAccountId(rawAccountId);
    const password = String(rawPassword ?? "");
    const database = await this.readDatabase();
    const user = database.users[accountId.toLocaleLowerCase("en-US")];
    if (!user || !await passwordMatches(password, user.password)) {
      throw new AccountError("The account ID or password is incorrect.", 401, "invalid_credentials");
    }
    return this.createAuthenticatedResult(user);
  }

  session(token) {
    const key = sessionKey(token);
    const session = key ? this.sessions.get(key) : null;
    if (!session) throw new AccountError("Please sign in again.", 401, "invalid_session");
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      throw new AccountError("Your session has expired. Please sign in again.", 401, "expired_session");
    }
    return session;
  }

  async account(token) {
    const session = this.session(token);
    const database = await this.readDatabase();
    const user = database.users[session.accountKey];
    if (!user) {
      this.sessions.delete(sessionKey(token));
      throw new AccountError("Please sign in again.", 401, "invalid_session");
    }
    return {
      user: publicUser(user),
      deckStore: publicDeckStore(user)
    };
  }

  logout(token) {
    const key = sessionKey(token);
    if (key) this.sessions.delete(key);
  }

  async saveDeckStore(token, rawStore) {
    const session = this.session(token);
    const deckStore = normalizeAccountDeckStore(rawStore);
    const updated = await this.mutate(async (database) => {
      const user = database.users[session.accountKey];
      if (!user) throw new AccountError("Please sign in again.", 401, "invalid_session");
      user.decks = deckStore.decks;
      user.activeDeckIds = deckStore.activeDeckIds;
      user.updatedAt = Date.now();
      return user;
    });
    return publicDeckStore(updated);
  }

  async createAuthenticatedResult(user) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(sessionKey(token), {
      accountKey: user.accountKey,
      expiresAt
    });
    return {
      token,
      expiresAt,
      user: publicUser(user),
      deckStore: publicDeckStore(user)
    };
  }

  async mutate(action) {
    let result;
    const operation = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const database = await this.readDatabase();
        result = await action(database);
        await this.writeDatabase(database);
      });
    this.writeQueue = operation;
    await operation;
    return result;
  }

  async readDatabase() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!parsed || parsed.version !== 1 || !parsed.users || typeof parsed.users !== "object") {
        throw new Error("Unsupported account database format.");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, users: {} };
      throw error;
    }
  }

  async writeDatabase(database) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.filePath);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
}

export const accountStore = new AccountStore();

export function bearerToken(req) {
  const authorization = String(req?.headers?.authorization || "");
  const match = authorization.match(/^Bearer\s+([^\s]+)$/iu);
  return match?.[1] || "";
}

function normalizeAccountId(value) {
  const accountId = String(value ?? "").trim().normalize("NFKC");
  if (!ACCOUNT_ID_PATTERN.test(accountId) || !/[\p{L}\p{N}]/u.test(accountId)) {
    throw new AccountError("Account IDs must be 3–24 letters, numbers, dots, underscores, or hyphens.", 400, "invalid_account_id");
  }
  return accountId;
}

function normalizePassword(value) {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 128) {
    throw new AccountError("Passwords must be 8–128 characters.", 400, "invalid_password");
  }
  return password;
}

async function createPasswordRecord(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return {
    algorithm: "scrypt-v1",
    salt: salt.toString("base64"),
    hash: Buffer.from(hash).toString("base64")
  };
}

async function passwordMatches(password, record) {
  if (!record || record.algorithm !== "scrypt-v1") return false;
  try {
    const salt = Buffer.from(record.salt, "base64");
    const expected = Buffer.from(record.hash, "base64");
    const actual = Buffer.from(await scrypt(password, salt, expected.length, SCRYPT_OPTIONS));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function normalizeAccountDeckStore(value) {
  const rawDecks = Array.isArray(value?.decks) ? value.decks : [];
  if (rawDecks.length > MAX_DECKS_PER_ACCOUNT) {
    throw new AccountError(`An account can store at most ${MAX_DECKS_PER_ACCOUNT} decks.`, 400, "too_many_decks");
  }
  const decks = rawDecks.map(normalizeAccountDeck);
  const ids = new Set();
  for (const deck of decks) {
    if (ids.has(deck.id)) throw new AccountError("Deck IDs must be unique.", 400, "duplicate_deck_id");
    ids.add(deck.id);
  }
  const activeDeckIds = (Array.isArray(value?.activeDeckIds) ? value.activeDeckIds : [])
    .slice(0, 2)
    .map((id) => String(id).slice(0, 100))
    .filter((id) => id.startsWith("default-") || ids.has(id));
  return { decks, activeDeckIds };
}

function normalizeAccountDeck(value) {
  const id = String(value?.id || "").trim().slice(0, 100);
  if (!id || id.startsWith("default-")) {
    throw new AccountError("Default decks cannot be overwritten.", 400, "default_deck_read_only");
  }
  if (!PERSONAL_DECK_ID_PATTERN.test(id)) {
    throw new AccountError("The submitted deck ID is invalid.", 400, "invalid_deck_id");
  }
  const deck = normalizeSubmittedDeck({ ...value, id });
  assertDeckShape(deck);
  return {
    ...deck,
    source: deck.source.slice(0, 240),
    isDefault: false
  };
}

function assertDeckShape(deck) {
  if (deck.battlefields.length > 3 || deck.main.length > 80 || deck.sideboard.length > 30 || deck.runes.length > 12) {
    throw new AccountError("The submitted deck is too large.", 400, "invalid_deck_size");
  }
  const groups = [deck.main, deck.sideboard, deck.runes];
  for (const entries of groups) {
    for (const [number, count] of entries) {
      if (!cardByNumber(number) || count > 100) {
        throw new AccountError("The submitted deck contains an unknown card or invalid count.", 400, "invalid_deck_card");
      }
    }
  }
  if (deck.legend && !cardByNumber(deck.legend)) {
    throw new AccountError("The submitted deck contains an unknown Legend.", 400, "invalid_deck_legend");
  }
  if (deck.battlefields.some((number) => !cardByNumber(number))) {
    throw new AccountError("The submitted deck contains an unknown Battlefield.", 400, "invalid_deck_battlefield");
  }
}

function publicUser(user) {
  return {
    id: user.id,
    accountId: user.accountId,
    createdAt: user.createdAt
  };
}

function publicDeckStore(user) {
  return {
    decks: structuredClone(user.decks || []),
    activeDeckIds: [...(user.activeDeckIds || [])]
  };
}

function sessionKey(token) {
  const normalized = String(token || "").trim();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

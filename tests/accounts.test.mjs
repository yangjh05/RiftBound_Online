import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AccountError, AccountStore } from "../server/accounts.mjs";
import { rawDecklists } from "../src/cards.mjs";

test("accounts persist hashed credentials and account-owned decks across a fresh login", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-accounts-"));
  const filePath = path.join(directory, "accounts.json");
  const password = "correct-horse-42";
  try {
    const firstStore = new AccountStore({ filePath });
    const signedUp = await firstStore.signUp("DeckKeeper", password);
    assert.equal(signedUp.user.accountId, "DeckKeeper");
    assert.equal(signedUp.deckStore.decks.length, 0);

    const raw = rawDecklists.provingGroundsAnnie;
    const personalDeck = {
      ...structuredClone(raw),
      id: "deck-account-owned",
      name: "My Annie Deck",
      isDefault: false
    };
    await firstStore.saveDeckStore(signedUp.token, {
      decks: [personalDeck],
      activeDeckIds: [personalDeck.id, "default-proving-grounds-master-yi"]
    });

    const serialized = await readFile(filePath, "utf8");
    assert.equal(serialized.includes(password), false, "the password must never be written in plaintext");
    assert.match(serialized, /"algorithm": "scrypt-v1"/u);

    const restartedStore = new AccountStore({ filePath });
    const loggedIn = await restartedStore.login("deckkeeper", password);
    assert.equal(loggedIn.user.id, signedUp.user.id);
    assert.equal(loggedIn.deckStore.decks[0].id, personalDeck.id);
    assert.equal(loggedIn.deckStore.decks[0].name, personalDeck.name);
    assert.deepEqual(loggedIn.deckStore.activeDeckIds, [personalDeck.id, "default-proving-grounds-master-yi"]);

    await restartedStore.saveDeckStore(loggedIn.token, {
      decks: [],
      activeDeckIds: ["default-keenan-xiong", "default-drowsy"]
    });
    const afterDeletion = await new AccountStore({ filePath }).login("deckkeeper", password);
    assert.deepEqual(afterDeletion.deckStore, {
      decks: [],
      activeDeckIds: ["default-keenan-xiong", "default-drowsy"]
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accounts reject duplicate IDs, bad credentials, and attempts to overwrite default decks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-account-guards-"));
  const filePath = path.join(directory, "accounts.json");
  try {
    const store = new AccountStore({ filePath });
    const account = await store.signUp("player.one", "password-123");
    await assert.rejects(
      store.signUp("PLAYER.ONE", "another-password"),
      (error) => error instanceof AccountError && error.code === "account_exists"
    );
    await assert.rejects(
      store.login("player.one", "wrong-password"),
      (error) => error instanceof AccountError && error.code === "invalid_credentials"
    );
    await assert.rejects(
      store.saveDeckStore(account.token, {
        decks: [{ id: "default-illegal-overwrite", name: "Changed default" }],
        activeDeckIds: []
      }),
      (error) => error instanceof AccountError && error.code === "default_deck_read_only"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

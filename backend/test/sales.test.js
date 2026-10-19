import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbPath = path.join(backendRoot, "data", "test-assistant.sqlite");
fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
for (const suffix of ["", "-shm", "-wal"]) {
  try { fs.unlinkSync(testDbPath + suffix); } catch {}
}
process.env.DATABASE_PATH = testDbPath;
process.env.LOG_LEVEL = "silent";

const { db } = await import("../src/db.js");
const sales = await import("../src/sales.js");
const { app } = await import("../src/app.js");
const { products } = await import("../src/catalog.js");

before(() => {
  const insert = db.prepare(`
    INSERT INTO products(id, name, sku, category, description, price_paise, stock, aliases)
    VALUES (@id, @name, @id, @category, @description, @price_paise, @stock, @aliases)
  `);
  for (const product of products) insert.run({ ...product, aliases: JSON.stringify(product.aliases) });
});

beforeEach(() => {
  db.exec("DELETE FROM quotation_items; DELETE FROM quotations; DELETE FROM handoffs; DELETE FROM messages; DELETE FROM cart_items; DELETE FROM conversations;");
  const resetProduct = db.prepare("UPDATE products SET price_paise = ?, stock = ?, aliases = ? WHERE id = ?");
  for (const product of products) resetProduct.run(product.price_paise, product.stock, JSON.stringify(product.aliases), product.id);
});

after(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(testDbPath + suffix); } catch {}
  }
});

const eventTime = "2026-10-19T10:30:00+05:30";
const send = (senderId, messageId, text, timestamp = eventTime) =>
  sales.processMessage({ senderId, messageId, timestamp, text });

test("seeds the fixed 12-product catalogue and exact price/stock values", () => {
  const catalogue = sales.listProducts();
  assert.equal(catalogue.length, 12);
  assert.deepEqual(
    [catalogue.find((item) => item.id === "P002").price_paise, catalogue.find((item) => item.id === "P002").stock],
    [120000, 30]
  );
  assert.deepEqual(
    [catalogue.find((item) => item.id === "P003").price_paise, catalogue.find((item) => item.id === "P003").stock],
    [800000, 10]
  );
});

test("quotes multiple products using exact integer-paise arithmetic", () => {
  const added = send("buyer-a", "m-1", "I need 2 keyboards, 3 monitors, and 1 mouse.");
  assert.equal(added.type, "item_added");
  assert.deepEqual(Object.fromEntries(added.cart.map((item) => [item.product_id, item.quantity])), { P003: 3, P002: 2, P001: 1 });
  const preview = send("buyer-a", "m-2", "quote");
  assert.deepEqual(preview.preview.items.map((item) => item.line_total_paise).sort((a, b) => a - b), [50000, 240000, 2400000]);
  assert.equal(preview.preview.subtotal_paise, 2690000);
  assert.equal(preview.preview.tax_paise, 484200);
  assert.equal(preview.preview.total_paise, 3174200);
  assert.equal(sales.listQuotations().length, 0);
  const confirmed = send("buyer-a", "m-3", "Confirm quotation");
  assert.equal(confirmed.type, "quotation_confirmed");
  const quotation = sales.listQuotations()[0];
  assert.deepEqual([quotation.subtotal_paise, quotation.tax_paise, quotation.total_paise], [2690000, 484200, 3174200]);
  assert.equal(quotation.items.length, 3);
  assert.equal(send("buyer-a", "m-4", "confirm").type, "message");
  assert.equal(sales.listQuotations().length, 1);
});

test("persists missing quantity questions and resolves a number-only answer", () => {
  const clarification = send("buyer-a", "m-1", "I need a keyboard.");
  assert.match(clarification.reply, /How many Mechanical Keyboards/);
  assert.equal(sales.getConversation("buyer-a").cart.length, 0);
  const pending = db.prepare("SELECT pending_action, pending_data FROM conversations WHERE sender_id = ?").get("buyer-a");
  assert.equal(pending.pending_action, "provide_quantity");
  assert.match(pending.pending_data, /P002/);
  const answer = send("buyer-a", "m-2", "three");
  assert.equal(answer.type, "item_added");
  assert.equal(sales.getConversation("buyer-a").cart[0].quantity, 3);
});

test("supports fuzzy product matching, quantity updates, and item removal", () => {
  const added = send("buyer-a", "m-1", "2 keybaord");
  assert.equal(added.type, "item_added");
  assert.equal(added.cart[0].product_id, "P002");
  const updated = send("buyer-a", "m-2", "make the keyboard quantity 5");
  assert.equal(updated.type, "quantity_updated");
  assert.equal(sales.getConversation("buyer-a").cart[0].quantity, 5);
  assert.equal(send("buyer-a", "m-3", "remove keyboard").type, "item_removed");
  assert.equal(sales.getConversation("buyer-a").cart.length, 0);
  const hubs = send("buyer-a", "m-4", "Can I get two USB hubs?");
  assert.equal(hubs.type, "item_added");
  assert.equal(hubs.cart.find((item) => item.product_id === "P004").quantity, 2);
});

test("asks for clarification when an exact alias matches multiple products", () => {
  const first = products.find((product) => product.id === "P004");
  const second = products.find((product) => product.id === "P010");
  db.prepare("UPDATE products SET aliases = ? WHERE id = ?").run(JSON.stringify([...first.aliases, "adapter"]), first.id);
  db.prepare("UPDATE products SET aliases = ? WHERE id = ?").run(JSON.stringify([...second.aliases, "adapter"]), second.id);
  const result = send("buyer-a", "m-1", "adapter");
  assert.equal(result.type, "clarification");
  assert.equal(result.candidates.length, 2);
  assert.equal(sales.getConversation("buyer-a").cart.length, 0);
  assert.equal(db.prepare("SELECT pending_action FROM conversations WHERE sender_id = ?").get("buyer-a").pending_action, "provide_product");
  assert.match(send("buyer-a", "m-2", "P004").reply, /How many USB-C Hubs/);
});

test("rejects invalid quantities and prevents stock over-promising", () => {
  for (const [messageId, text] of [["m-1", "0 mouse"], ["m-2", "-1 mouse"], ["m-3", "1.5 mouse"]]) {
    assert.notEqual(send("buyer-a", messageId, text).type, "item_added");
  }
  const shortage = send("buyer-a", "m-4", "12 monitors");
  assert.equal(shortage.type, "stock_unavailable");
  assert.match(shortage.reply, /Only 10/);
  assert.equal(sales.getConversation("buyer-a").cart.length, 0);
});

test("does not treat an unrelated yes as quotation confirmation", () => {
  const yes = send("buyer-a", "m-1", "yes");
  assert.notEqual(yes.type, "quotation_confirmed");
  assert.equal(sales.listQuotations().length, 0);
});

test("invalidates previews after price or stock changes and requires a fresh review", () => {
  send("buyer-a", "m-1", "1 keyboard");
  send("buyer-a", "m-2", "quote");
  db.prepare("UPDATE products SET price_paise = ? WHERE id = ?").run(130000, "P002");
  const changedPrice = send("buyer-a", "m-3", "confirm");
  assert.equal(changedPrice.type, "reconfirmation_required");
  assert.equal(changedPrice.preview.subtotal_paise, 130000);
  assert.equal(sales.listQuotations().length, 0);
  assert.equal(send("buyer-a", "m-4", "yes").type, "quotation_confirmed");

  send("buyer-b", "m-5", "2 mouse");
  send("buyer-b", "m-6", "quote");
  db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(1, "P001");
  assert.equal(send("buyer-b", "m-7", "confirm").type, "stock_changed");
});

test("cancels a preview without creating a quotation", () => {
  send("buyer-a", "m-1", "1 mouse");
  send("buyer-a", "m-2", "quote");
  assert.equal(send("buyer-a", "m-3", "cancel quotation").type, "cancelled");
  assert.equal(sales.listQuotations().length, 0);
  assert.equal(sales.getConversation("buyer-a").cart.length, 0);
});

test("idempotently replays an event and rejects a reused ID with different content", () => {
  const first = send("buyer-a", "external-1", "1 mouse");
  const replay = send("buyer-a", "external-1", "1 mouse");
  assert.equal(replay.replayed, true);
  assert.equal(replay.type, first.type);
  assert.equal(sales.getConversation("buyer-a").cart[0].quantity, 1);
  assert.throws(() => send("buyer-a", "external-1", "2 mouse"), sales.IdempotencyConflictError);
  assert.throws(() => send("buyer-b", "external-1", "1 mouse"), sales.IdempotencyConflictError);
  assert.throws(() => send("buyer-a", "external-1", "1 mouse", "not a timestamp"), TypeError);
});

test("keeps carts and quotations isolated between interleaved customers", () => {
  send("CUST-001", "a-1", "2 keyboards");
  send("CUST-002", "b-1", "1 monitor");
  send("CUST-001", "a-2", "quote");
  send("CUST-002", "b-2", "cart");
  assert.deepEqual(sales.getConversation("CUST-001").cart.map((item) => item.product_id), ["P002"]);
  assert.deepEqual(sales.getConversation("CUST-002").cart.map((item) => item.product_id), ["P003"]);
  send("CUST-001", "a-3", "confirm");
  assert.equal(sales.listQuotations("CUST-001").length, 1);
  assert.equal(sales.listQuotations("CUST-002").length, 0);
});

test("creates a contextual local handoff without claiming an employee was contacted", () => {
  send("buyer-a", "m-1", "2 mouse");
  const response = send("buyer-a", "m-2", "Can I get a custom bulk discount?");
  assert.equal(send("buyer-a", "m-2", "Can I get a custom bulk discount?").replayed, true);
  assert.equal(response.type, "handoff");
  assert.match(response.reply, /No employee has been contacted/);
  const requests = sales.listHandoffs("open");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].context.cart[0].quantity, 2);
  assert.ok(requests[0].context.recentMessages.some((message) => /custom bulk discount/.test(message.text)));
  const updated = sales.updateHandoffStatus(response.handoffId, "in_progress");
  assert.equal(updated.status, "in_progress");
  assert.deepEqual(updated.history.map(({ previous_status, new_status }) => [previous_status, new_status]), [["open", "in_progress"]]);
  assert.equal(sales.updateHandoffStatus(response.handoffId, "in_progress").history.length, 1);
});

test("rolls back the quotation when a quotation-item insert fails", () => {
  send("buyer-a", "m-1", "1 keyboard");
  send("buyer-a", "m-2", "quote");
  db.exec(`
    CREATE TRIGGER reject_test_quotation_item BEFORE INSERT ON quotation_items
    BEGIN SELECT RAISE(ABORT, 'forced test failure'); END
  `);
  try {
    assert.throws(() => send("buyer-a", "m-3", "confirm"), /forced test failure/);
    assert.equal(sales.listQuotations().length, 0);
    assert.equal(sales.getConversation("buyer-a").cart[0].quantity, 1);
  } finally {
    db.exec("DROP TRIGGER reject_test_quotation_item");
  }
});

test("handles simultaneous requests with the same event ID exactly once", async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const event = {
    sender_id: "concurrent-buyer", message_id: "concurrent-1",
    timestamp: eventTime, text: "2 keyboards"
  };
  try {
    const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/webhook/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event)
    })));
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(bodies.map((body) => body.replayed).sort(), [false, true]);
    assert.equal(sales.getConversation("concurrent-buyer").cart[0].quantity, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("validates webhook timestamps and returns seeded catalogue through the API", async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const invalid = await fetch(`${base}/api/webhook/messages`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_id: "buyer-a", message_id: "bad", timestamp: "bad-date", text: "1 mouse" })
    });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${base}/api/products`);
    assert.equal((await response.json()).products.length, 12);
    const event = {
      sender_id: "buyer-http", message_id: "http-1",
      timestamp: "2026-10-19T10:30:00+05:30", text: "1 mouse"
    };
    const posted = await fetch(`${base}/api/webhook/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event)
    });
    assert.equal(posted.status, 200);
    assert.equal((await posted.json()).sender_id, "buyer-http");
    const conflict = await fetch(`${base}/api/webhook/messages`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, text: "2 mouse" })
    });
    assert.equal(conflict.status, 409);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("serves real overview, conversation inbox, and persisted activity records", async () => {
  send("overview-buyer", "overview-1", "I need a keyboard.");
  send("overview-buyer", "overview-2", "3");
  send("overview-buyer", "overview-3", "quote");
  send("overview-handoff", "overview-4", "Can I get a custom bulk discount?");
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [overviewResponse, conversationsResponse, activityResponse] = await Promise.all([
      fetch(`${base}/api/overview`),
      fetch(`${base}/api/conversations?search=overview-buyer`),
      fetch(`${base}/api/activity?search=overview-buyer&limit=10`)
    ]);
    assert.equal(overviewResponse.status, 200);
    assert.equal(conversationsResponse.status, 200);
    assert.equal(activityResponse.status, 200);

    const { overview } = await overviewResponse.json();
    assert.equal(overview.counts.totalConversations, 2);
    assert.equal(overview.counts.pendingConfirmations, 1);
    assert.equal(overview.counts.openHandoffs, 1);
    assert.equal(overview.recentConversations.length, 2);

    const { conversations } = await conversationsResponse.json();
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].sender_id, "overview-buyer");
    assert.equal(conversations[0].pending_action, "confirm_quotation");

    const { activity } = await activityResponse.json();
    assert.ok(activity.some((event) => event.type === "clarification"));
    assert.ok(activity.some((event) => event.type === "quotation_preview"));
    assert.ok(activity.every((event) => event.senderId === "overview-buyer"));
    assert.equal((await fetch(`${base}/api/activity?limit=201`)).status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

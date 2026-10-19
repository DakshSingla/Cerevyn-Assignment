import { createHash, randomUUID } from "node:crypto";
import Fuse from "fuse.js";
import { db } from "./db.js";
import { config } from "./config.js";

const money = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normalize = (value) => value.toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
const allProducts = () => db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY name").all()
  .map((product) => ({ ...product, aliases: JSON.parse(product.aliases) }));
const taxRateBasisPoints = config.taxRateBasisPoints;
const taxPercent = taxRateBasisPoints / 100;

export function listProducts() {
  return allProducts();
}

export function getProduct(id) {
  return allProducts().find((product) => product.id.toLowerCase() === id.toLowerCase()) || null;
}

function getOrCreateConversation(senderId) {
  db.prepare("INSERT INTO conversations(sender_id) VALUES (?) ON CONFLICT(sender_id) DO NOTHING").run(senderId);
  const conversation = db.prepare("SELECT * FROM conversations WHERE sender_id = ?").get(senderId);
  db.prepare("INSERT INTO carts(conversation_id, sender_id) VALUES (?, ?) ON CONFLICT(conversation_id) DO NOTHING")
    .run(conversation.id, senderId);
  return conversation;
}

function getCart(conversationId) {
  return db.prepare(`
    SELECT p.id AS product_id, p.name, p.price_paise AS unit_price_paise,
      c.unit_price_paise AS unit_price_snapshot_paise, p.stock, c.quantity
    FROM cart_items c JOIN products p ON p.id = c.product_id
    WHERE c.conversation_id = ? ORDER BY p.name
  `).all(conversationId);
}

function lookupProduct(text, products) {
  const query = normalize(text);
  const idMatch = products.find((product) => normalize(product.id) === query);
  if (idMatch) return { status: "matched", productId: idMatch.id, product: idMatch, matchedBy: "id", confidence: 1 };
  const nameMatch = products.find((product) => normalize(product.name) === query);
  if (nameMatch) return { status: "matched", productId: nameMatch.id, product: nameMatch, matchedBy: "name", confidence: 1 };
  const exact = products.filter((product) =>
    [product.name, ...product.aliases].some((alias) => query.includes(normalize(alias)))
  );
  const unique = [...new Map(exact.map((product) => [product.id, product])).values()];
  if (unique.length === 1) return { status: "matched", productId: unique[0].id, product: unique[0], matchedBy: "alias", confidence: 1 };
  if (unique.length > 1) return { status: "clarification", ambiguous: unique, candidates: unique };

  const cleaned = query.replace(/\b\d+\b/g, " ")
    .replace(/\b(add|i need|i want|want|need|please|pls|can i get|mujhe|chahiye|ka|ki|kharidna|buy)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!cleaned) return { status: "unmatched", product: null };
  const fuse = new Fuse(products, {
    keys: [{ name: "name", weight: 0.75 }, { name: "aliases", weight: 0.25 }],
    threshold: 0.45,
    includeScore: true,
    ignoreLocation: true
  });
  const matches = fuse.search(cleaned).filter((result) => result.score < 0.45);
  if (!matches.length) return { status: "unmatched", product: null };
  const bestScore = matches[0].score;
  const ties = matches.filter((result) => Math.abs(result.score - bestScore) < 0.025)
    .map((result) => result.item);
  if (ties.length !== 1) return { status: "clarification", ambiguous: ties, candidates: ties };
  return { status: "matched", productId: ties[0].id, product: ties[0], matchedBy: "fuzzy", confidence: 1 - bestScore };
}

const numberWords = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14],
  ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["eighteen", 18],
  ["nineteen", 19], ["twenty", 20]
]);

function readQuantity(value) {
  const token = normalize(value).match(/(?:^|[\s,])(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:more\s+)?(?:pcs?|pieces?|units?)?(?:\s+and)?\s*$/)?.[1];
  if (!token) return null;
  return numberWords.get(token) ?? Number(token);
}

function readLeadingQuantity(value) {
  const cleaned = normalize(value).replace(/^(?:(?:please|add|i need|i want|need|want|mujhe|can i get)\s+)*/, "");
  return readQuantity(cleaned.match(/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/)?.[0] || "");
}

function pluralProductName(name) {
  if (name.endsWith("Mouse")) return `${name.slice(0, -5)}Mice`;
  return /s$/i.test(name) ? name : `${name}s`;
}

function findProductMentions(text, products) {
  const query = normalize(text);
  const matches = [];
  for (const product of products) {
    const terms = new Set([product.id, product.name, ...product.aliases].map(normalize).filter(Boolean));
    for (const term of terms) {
      let from = 0;
      while (from < query.length) {
        const start = query.indexOf(term, from);
        if (start < 0) break;
        const end = start + term.length;
        const leftBoundary = start === 0 || query[start - 1] === " ";
        const rightBoundary = end === query.length || query[end] === " ";
        if (leftBoundary && rightBoundary) matches.push({ start, end, product, term });
        from = start + 1;
      }
    }
  }

  matches.sort((left, right) => left.start - right.start || right.term.length - left.term.length);
  const selected = [];
  for (const match of matches) {
    const overlapping = selected.find((item) => match.start < item.end && item.start < match.end);
    if (!overlapping) {
      selected.push(match);
    } else if (match.start === overlapping.start && match.end === overlapping.end && match.product.id !== overlapping.product.id) {
      overlapping.candidates = [...new Map([...(overlapping.candidates || [overlapping.product]), match.product].map((item) => [item.id, item])).values()];
    }
  }
  selected.sort((left, right) => left.start - right.start);

  let previousEnd = 0;
  return selected.map((match) => {
    const quantity = readQuantity(query.slice(previousEnd, match.start));
    previousEnd = match.end;
    return { ...match, quantity };
  });
}

function storePending(context, conversationId) {
  const pendingAction = context.pending_product_options?.length
    ? "provide_product"
    : context.pending_quantity?.length
      ? "provide_quantity"
      : context.pending_preview
        ? "confirm_quotation"
        : null;
  const pendingData = pendingAction === "provide_product"
    ? { options: context.pending_product_options }
    : pendingAction === "provide_quantity"
      ? { quantities: context.pending_quantity }
      : context.pending_preview
        ? { preview: context.pending_preview }
        : null;
  const state = pendingAction === "provide_product"
    ? "awaiting_product"
    : pendingAction === "provide_quantity"
      ? "awaiting_quantity"
      : pendingAction === "confirm_quotation"
        ? "awaiting_confirmation"
        : "active";
  db.prepare(`
    UPDATE conversations SET context_json = ?, pending_action = ?, pending_data = ?,
      state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(JSON.stringify(context), pendingAction, pendingData ? JSON.stringify(pendingData) : null, state, conversationId);
  db.prepare("UPDATE carts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE conversation_id = ?")
    .run(pendingAction === "confirm_quotation" ? "pending_confirmation" : "active", conversationId);
}

function addCartQuantity(conversation, product, quantity, replace = false) {
  const current = db.prepare("SELECT stock, name, price_paise FROM products WHERE id = ? AND active = 1").get(product.id);
  if (!current) return { error: "That product is no longer available in the catalogue." };
  const existing = db.prepare("SELECT quantity FROM cart_items WHERE conversation_id = ? AND product_id = ?")
    .get(conversation.id, product.id)?.quantity || 0;
  const requested = replace ? quantity : existing + quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
    return { error: "Please provide a whole-number quantity between 1 and 10,000." };
  }
  if (requested > current.stock) {
    return { stock: current.stock, current: existing, requested, name: current.name };
  }
  db.prepare(`
    INSERT INTO cart_items(conversation_id, product_id, quantity, unit_price_paise, cart_id)
    VALUES (?, ?, ?, ?, (SELECT id FROM carts WHERE conversation_id = ?))
    ON CONFLICT(conversation_id, product_id) DO UPDATE SET
      quantity = excluded.quantity, unit_price_paise = excluded.unit_price_paise
  `).run(conversation.id, product.id, requested, current.price_paise, conversation.id);
  db.prepare("UPDATE carts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE conversation_id = ?")
    .run(conversation.id);
  return { quantity: requested, name: current.name };
}

function createPreview(conversationId) {
  const cart = getCart(conversationId);
  if (!cart.length) return { error: "Your cart is empty. Tell me which product and quantity you need." };
  const items = cart.map(({ product_id, name, unit_price_paise, unit_price_snapshot_paise, quantity, stock }) => ({
    product_id,
    name,
    quantity,
    unit_price_paise,
    line_total_paise: unit_price_paise * quantity,
    available_quantity: stock,
    availability_status: quantity <= stock ? "available" : "insufficient_stock",
    price_changed: unit_price_snapshot_paise !== unit_price_paise
  }));
  const subtotal_paise = items.reduce((sum, item) => sum + item.line_total_paise, 0);
  // Hinglish: Basis points aur integer paise se rounding predictable rehti hai.
  const tax_paise = Math.floor((subtotal_paise * taxRateBasisPoints + 5000) / 10000);
  return {
    items, subtotal_paise, tax_paise, total_paise: subtotal_paise + tax_paise,
    has_stock_shortage: items.some((item) => item.availability_status !== "available"),
    has_price_changes: items.some((item) => item.price_changed),
    tax_percent: taxPercent, tax_rate_basis_points: taxRateBasisPoints, created_at: new Date().toISOString()
  };
}

function previewResponse(preview, prefix = "Quotation preview") {
  const lines = preview.items.map((item) =>
    `${item.name} (${item.product_id}) × ${item.quantity} at ${money(item.unit_price_paise)}: ${money(item.line_total_paise)} — ${item.availability_status === "available" ? `${item.available_quantity} available` : `only ${item.available_quantity} available`}${item.price_changed ? " · catalogue price changed" : ""}`
  );
  const priceNotice = preview.has_price_changes
    ? "\nA catalogue price changed since it was added; review this updated total before confirming."
    : "";
  return {
    reply: `${prefix}\n${lines.join("\n")}\nSubtotal: ${money(preview.subtotal_paise)}\nTax (${preview.tax_percent}%): ${money(preview.tax_paise)}\nTotal: ${money(preview.total_paise)}${priceNotice}\n\nReply CONFIRM to create this quotation, or change your cart first.`,
    type: "quotation_preview", preview
  };
}

function handoff(conversation, reason, currentText) {
  const recent = db.prepare(`
    SELECT direction, text, event_timestamp FROM conversation_messages
    WHERE conversation_id = ? ORDER BY id DESC LIMIT 12
  `).all(conversation.id).reverse().map((message) => ({
    direction: message.direction,
    text: message.text,
    timestamp: message.event_timestamp
  }));
  recent.push({ direction: "incoming", text: currentText, timestamp: new Date().toISOString() });
  const context = {
    senderId: conversation.sender_id,
    state: conversation.state,
    cart: getCart(conversation.id),
    context: JSON.parse(conversation.context_json),
    recentMessages: recent
  };
  const handoffId = `HO-${randomUUID().slice(0, 8).toUpperCase()}`;
  const result = db.prepare(`
    INSERT INTO handoffs(handoff_id, sender_id, conversation_id, reason, context_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(handoffId, conversation.sender_id, conversation.id, reason, JSON.stringify(context));
  db.prepare("UPDATE conversations SET state = 'human_handoff', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(conversation.id);
  return {
    reply: `I cannot complete this request automatically. A local support handoff ${handoffId} has been created with your conversation details for a sales representative to review. No employee has been contacted by this demo.`,
    type: "handoff", handoffId: result.lastInsertRowid, handoff_id: handoffId
  };
}

function handleConfirm(conversation) {
  const context = JSON.parse(conversation.context_json);
  const preview = context.pending_preview;
  if (!preview) {
    return { reply: "There isn’t a quotation preview waiting for confirmation. Send QUOTE to review your cart first.", type: "message" };
  }
  const cart = getCart(conversation.id);
  const currentById = new Map(cart.map((item) => [item.product_id, item]));
  const sameCart = preview.items.length === cart.length && preview.items.every((item) =>
    currentById.has(item.product_id) && currentById.get(item.product_id).quantity === item.quantity
  );
  const stockIssue = cart.find((item) => item.quantity > item.stock);
  const changedPrice = preview.items.some((item) =>
    currentById.has(item.product_id) && currentById.get(item.product_id).unit_price_paise !== item.unit_price_paise
  );
  if (!sameCart || changedPrice || stockIssue) {
    if (stockIssue) {
      delete context.pending_preview;
      storePending(context, conversation.id);
      return {
        reply: `Stock changed: only ${stockIssue.stock} × ${stockIssue.name} are available, but your cart has ${stockIssue.quantity}. Update your cart and request a new quote.`,
        type: "stock_changed"
      };
    }
    const refreshed = createPreview(conversation.id);
    context.pending_preview = refreshed;
    storePending(context, conversation.id);
    return {
      ...previewResponse(refreshed, "Your cart or pricing changed, so the previous preview is no longer valid. Updated preview:"),
      type: "reconfirmation_required"
    };
  }

  // Hinglish: Random UUID-derived enquiry ID concurrent confirmations mein collision avoid karta hai.
  const quotationId = `QTN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const cartId = db.prepare("SELECT id FROM carts WHERE conversation_id = ?").get(conversation.id).id;
  db.prepare(`
    INSERT INTO quotations(id, enquiry_id, sender_id, conversation_id, cart_id,
      subtotal_paise, tax_rate_basis_points, tax_paise, total_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(quotationId, quotationId, conversation.sender_id, conversation.id, cartId,
    preview.subtotal_paise, taxRateBasisPoints, preview.tax_paise, preview.total_paise);
  const insertItem = db.prepare(`
    INSERT INTO quotation_items(quotation_id, product_id, product_name, quantity, unit_price_paise, line_total_paise)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of preview.items) {
    insertItem.run(quotationId, item.product_id, item.name, item.quantity, item.unit_price_paise, item.line_total_paise);
  }
  db.prepare("DELETE FROM cart_items WHERE conversation_id = ?").run(conversation.id);
  delete context.pending_preview;
  storePending(context, conversation.id);
  db.prepare("UPDATE carts SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(cartId);
  return {
    reply: `Quotation ${quotationId} confirmed.\nSubtotal: ${money(preview.subtotal_paise)}\nTax (${preview.tax_percent}%): ${money(preview.tax_paise)}\nTotal: ${money(preview.total_paise)}`,
    type: "quotation_confirmed", quotationId
  };
}

function processText(conversation, text) {
  const normalized = normalize(text);
  const context = JSON.parse(conversation.context_json);
  const products = allProducts();

  if (/\b\d+\.\d+\b|(?:^|[\s,])-\d+\b/.test(text)) {
    return { reply: "Quantity must be a whole positive integer; negative and decimal quantities are not supported.", type: "clarification" };
  }
  if (/^(hi|hello|hey|namaste|namaskar)\b/.test(normalized)) {
    return { reply: "Namaste! Tell me a product and quantity (for example, “2 keyboards”), or ask for the catalogue.", type: "message" };
  }
  if (/\b(catalog|catalogue|products|list products)\b/.test(normalized)) {
    const names = products.map((product) => `${product.id} ${product.name} — ${money(product.price_paise)} (${product.stock} in stock)`).join("\n");
    return { reply: `Available products:\n${names}`, type: "catalogue" };
  }
  if (/\b(human|agent|representative|sales person|sales representative|support|international shipping|custom discount|bulk discount)\b/.test(normalized)
    || /\b(?:speak|talk) to (?:a )?(?:sales|someone|human|representative)\b/.test(normalized)) {
    return handoff(conversation, text, text);
  }
  if (/^(cancel|no[, ]+cancel|cancel quotation|cancel quote|remove the pending quotation)\b/.test(normalized)) {
    db.prepare("DELETE FROM cart_items WHERE conversation_id = ?").run(conversation.id);
    delete context.pending_preview;
    delete context.pending_quantity;
    delete context.pending_product_options;
    storePending(context, conversation.id);
    db.prepare("UPDATE carts SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE conversation_id = ?").run(conversation.id);
    db.prepare("UPDATE conversations SET state = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversation.id);
    return { reply: "The pending cart or quotation preview has been cancelled. No quotation was created.", type: "cancelled" };
  }
  if (/^(confirm|yes|haan|ha|ok confirm|proceed(?: with the quotation)?)\b/.test(normalized)) {
    if (!context.pending_preview) return { reply: "There is no quotation waiting for confirmation. Send QUOTE to review your cart first.", type: "message" };
    return handleConfirm(conversation);
  }
  if (/\b(clear|empty)\s+(my\s+)?(cart|basket)\b/.test(normalized)) {
    db.prepare("DELETE FROM cart_items WHERE conversation_id = ?").run(conversation.id);
    delete context.pending_preview;
    delete context.pending_quantity;
    delete context.pending_product_options;
    storePending(context, conversation.id);
    return { reply: "Your cart is now empty. Add the items and quantities you need.", type: "cart_cleared" };
  }
  if (/\b(remove|delete|take out)\b/.test(normalized)) {
    const match = lookupProduct(text, products);
    if (!match.product) return { reply: "Which catalogue item should I remove from your cart?", type: "clarification" };
    const result = db.prepare("DELETE FROM cart_items WHERE conversation_id = ? AND product_id = ?")
      .run(conversation.id, match.product.id);
    context.pending_quantity = (context.pending_quantity || [])
      .filter(({ product }) => product.id !== match.product.id);
    if (!context.pending_quantity.length) delete context.pending_quantity;
    context.pending_product_options = (context.pending_product_options || [])
      .filter((product) => product.id !== match.product.id);
    if (!context.pending_product_options.length) delete context.pending_product_options;
    delete context.pending_preview;
    storePending(context, conversation.id);
    return {
      reply: result.changes ? `Removed ${match.product.name} from your cart.` : `${match.product.name} wasn’t in your cart.`,
      type: "item_removed", cart: getCart(conversation.id)
    };
  }
  const updateQuantity = /\b(?:make|set|update|change)\b/.test(normalized) && /\b(?:quantity|qty|to)\b/.test(normalized);
  if (updateQuantity) {
    const match = lookupProduct(text, products);
    const quantity = readQuantity(normalized.split(/\b(?:quantity|qty|to)\b/).pop());
    if (!match.product) return { reply: "Which catalogue product should I update?", type: "clarification" };
    if (!quantity) return { reply: `What whole-number quantity would you like for ${match.product.name}?`, type: "clarification" };
    const updated = addCartQuantity(conversation, match.product, quantity, true);
    if (updated.stock !== undefined) return { reply: `Only ${updated.stock} ${updated.name} are available. Your requested quantity is ${quantity}; choose a lower quantity or remove the item.`, type: "stock_unavailable" };
    if (updated.error) return { reply: updated.error, type: "clarification" };
    delete context.pending_preview;
    storePending(context, conversation.id);
    return { reply: `Updated ${updated.name} quantity to ${updated.quantity}. Send QUOTE to review the changed cart.`, type: "quantity_updated", cart: getCart(conversation.id) };
  }
  if (/\b(preview|quote|quotation|estimate|total)\b/.test(normalized)) {
    const preview = createPreview(conversation.id);
    if (preview.error) return { reply: preview.error, type: "message" };
    if (preview.has_stock_shortage) {
      const shortages = preview.items.filter((item) => item.availability_status !== "available");
      return {
        reply: `${shortages.map((item) => `Only ${item.available_quantity} ${item.name} are currently available; your cart has ${item.quantity}.`).join("\n")}\nPlease reduce the quantity or remove the affected item before requesting a quotation.`,
        type: "stock_unavailable",
        shortages
      };
    }
    context.pending_preview = preview;
    storePending(context, conversation.id);
    return previewResponse(preview);
  }
  if (/\b(cart|basket)\b/.test(normalized) && !/\b(add|need|want|buy)\b/.test(normalized)) {
    const cart = getCart(conversation.id);
    if (!cart.length) return { reply: "Your cart is empty. Tell me a product and quantity to add.", type: "cart" };
    const subtotal = cart.reduce((sum, item) => sum + item.unit_price_paise * item.quantity, 0);
    return {
      reply: `Your cart:\n${cart.map((item) => `${item.name} × ${item.quantity} — ${money(item.unit_price_paise * item.quantity)}`).join("\n")}\nCart subtotal: ${money(subtotal)}`,
      type: "cart", cart
    };
  }

  if (/\b(stock|available|availability|do you have)\b/.test(normalized) && !/\b(add|buy|order|need\s+\d+|want\s+\d+)\b/.test(normalized)) {
    const match = lookupProduct(text, products);
    if (match.ambiguous) {
      return { reply: `Which product's stock would you like to check?\n${match.ambiguous.map((product) => `• ${product.id} ${product.name}`).join("\n")}`, type: "clarification" };
    }
    if (match.product) {
      return { reply: `${match.product.name} (${match.product.id}) currently has ${match.product.stock} units available.`, type: "stock_query", product: { id: match.product.id, name: match.product.name, stock: match.product.stock } };
    }
  }

  if (context.pending_product_options?.length) {
    const selection = lookupProduct(text, context.pending_product_options);
    if (!selection.product) {
      return {
        reply: `Please choose one of these products by name or ID:\n${context.pending_product_options.map((product) => `• ${product.id} ${product.name}`).join("\n")}`,
        type: "clarification",
        candidates: context.pending_product_options.map(({ id, name }) => ({ id, name }))
      };
    }
    delete context.pending_product_options;
    context.pending_quantity = [{ product: selection.product, name: selection.product.name }];
    storePending(context, conversation.id);
    return {
      reply: `How many ${pluralProductName(selection.product.name)} would you like?`,
      type: "clarification",
      product: selection.product
    };
  }

  if (context.pending_quantity?.length) {
    const quantity = readQuantity(normalized);
    if (!quantity)     return { reply: `How many ${pluralProductName(context.pending_quantity[0].name)} would you like? Please enter a whole number from 1 to 10,000.`, type: "clarification" };
    const pending = context.pending_quantity.shift();
    const result = addCartQuantity(conversation, pending.product, quantity);
    if (result.stock !== undefined) {
      return { reply: `Only ${result.stock} ${result.name} are available. Please choose a lower quantity or remove this item.`, type: "stock_unavailable" };
    }
    if (result.error) return { reply: result.error, type: "clarification" };
    delete context.pending_preview;
    if (context.pending_quantity.length) {
      storePending(context, conversation.id);
      return { reply: `Added ${quantity} × ${result.name}. How many ${context.pending_quantity[0].name} would you like?`, type: "clarification", cart: getCart(conversation.id) };
    }
    delete context.pending_quantity;
    storePending(context, conversation.id);
    return { reply: `Added ${quantity} × ${result.name} to your cart. Send QUOTE to review the totals.`, type: "item_added", cart: getCart(conversation.id) };
  }

  const mentions = findProductMentions(text, products);
  if (mentions.length && /\b\d+\.\d+\b/.test(text)) {
    return { reply: "Quantity must be a whole positive integer; decimal quantities are not supported.", type: "clarification" };
  }
  const ambiguous = mentions.find((mention) => mention.candidates?.length);
  if (ambiguous) {
    const candidates = ambiguous.candidates.map(({ id, name }) => ({ id, name }));
    context.pending_product_options = ambiguous.candidates;
    storePending(context, conversation.id);
    return {
      reply: `Which product did you mean?\n${candidates.slice(0, 5).map((product) => `• ${product.id} ${product.name}`).join("\n")}`,
      type: "clarification", candidates
    };
  }
  if (!mentions.length) {
    const match = lookupProduct(text, products);
    if (match.ambiguous) {
      context.pending_product_options = match.ambiguous;
      storePending(context, conversation.id);
      return { reply: `Which product did you mean?\n${match.ambiguous.map((product) => `• ${product.id} ${product.name}`).join("\n")}`, type: "clarification" };
    }
    if (!match.product) {
      if (/\b(discount|shipping|not in (?:the )?catalogue|not listed)\b/.test(normalized)) {
        return handoff(conversation, text, text);
      }
      if (/\b(?:do you (?:sell|carry|have)|can i (?:get|buy)|looking for)\b/.test(normalized)) {
        return handoff(conversation, `Catalogue product request: ${text}`, text);
      }
      return { reply: "I couldn’t identify a catalogue product. Try an exact product name or ask for “catalogue”.", type: "clarification" };
    }
    const quantity = readLeadingQuantity(normalized);
    if (quantity === null) {
      context.pending_quantity = [{ product: match.product, name: match.product.name }];
      storePending(context, conversation.id);
      return { reply: `How many ${pluralProductName(match.product.name)} would you like?`, type: "clarification", product: match.product };
    }
    mentions.push({ product: match.product, quantity });
  }

  const requests = new Map();
  for (const mention of mentions) {
    if (mention.quantity !== null && mention.quantity < 1) {
      return { reply: "Quantity must be a whole positive integer greater than zero.", type: "clarification" };
    }
    const previous = requests.get(mention.product.id) || { product: mention.product, quantity: 0 };
    if (mention.quantity !== null) previous.quantity += mention.quantity;
    else previous.missing = true;
    requests.set(mention.product.id, previous);
  }

  const pending = [...requests.values()].filter((request) => request.missing)
    .map(({ product }) => ({ product, name: product.name }));
  const additions = [...requests.values()].filter((request) => request.quantity > 0);
  const invalid = additions.find((request) => !Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 10000);
  if (invalid) return { reply: "Please provide whole-number quantities between 1 and 10,000.", type: "clarification" };

  const shortages = [];
  for (const request of additions) {
    const current = db.prepare("SELECT stock FROM products WHERE id = ?").get(request.product.id);
    const inCart = db.prepare("SELECT quantity FROM cart_items WHERE conversation_id = ? AND product_id = ?")
      .get(conversation.id, request.product.id)?.quantity || 0;
    if (inCart + request.quantity > current.stock) {
      shortages.push({ name: request.product.name, stock: current.stock, available: Math.max(0, current.stock - inCart), requested: request.quantity });
      continue;
    }
    addCartQuantity(conversation, request.product, request.quantity);
  }
  if (pending.length) {
    context.pending_quantity = pending;
    delete context.pending_preview;
    storePending(context, conversation.id);
  } else if (additions.length) {
    delete context.pending_preview;
    delete context.pending_quantity;
    storePending(context, conversation.id);
  }

  if (shortages.length) {
    const details = shortages.map((shortage) =>
      `Only ${shortage.stock} ${shortage.name} are available; your cart can take ${shortage.available} more, but you asked for ${shortage.requested}.`
    ).join("\n");
    return { reply: `${details}\nChange the quantity or remove the item.`, type: "stock_unavailable", shortages, cart: getCart(conversation.id) };
  }
  if (pending.length) {
    return { reply: `How many ${pluralProductName(pending[0].name)} would you like?`, type: "clarification", pending: pending.map(({ name }) => name), cart: getCart(conversation.id) };
  }
  if (!additions.length) return { reply: "I didn’t find a product quantity to add. Ask for the catalogue or provide a product and quantity.", type: "unknown" };

  const cart = getCart(conversation.id);
  db.prepare("UPDATE conversations SET state = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversation.id);
  return {
    reply: `Added ${additions.map(({ product, quantity }) => `${quantity} × ${product.name}`).join(", ")} to your cart. You can add another item, say CART to review it, or QUOTE to preview totals.`,
    type: "item_added", cart
  };
}

export class IdempotencyConflictError extends Error {}

function intentForResult(result) {
  const intents = {
    item_added: "ADD_PRODUCT",
    quantity_updated: "UPDATE_QUANTITY",
    item_removed: "REMOVE_PRODUCT",
    cart: "VIEW_CART",
    cart_cleared: "VIEW_CART",
    quotation_preview: "PRODUCT_ENQUIRY",
    quotation_confirmed: "CONFIRM_QUOTATION",
    cancelled: "CANCEL_QUOTATION",
    stock_query: "STOCK_QUERY",
    stock_unavailable: "PRODUCT_ENQUIRY",
    handoff: "HUMAN_HANDOFF",
    clarification: result.candidates ? "PROVIDE_PRODUCT" : "PROVIDE_QUANTITY",
    unknown: "UNKNOWN"
  };
  return intents[result.type] || "PRODUCT_ENQUIRY";
}

export function processMessage({ senderId, messageId, timestamp = new Date().toISOString(), text }) {
  const eventTime = new Date(timestamp);
  if (!Number.isFinite(eventTime.getTime())) throw new TypeError("Timestamp must be a valid ISO 8601 datetime.");
  const payloadHash = createHash("sha256").update(JSON.stringify({ senderId, text, timestamp })).digest("hex");
  const run = db.transaction(() => {
    const existing = db.prepare("SELECT sender_id, payload_hash, response_json FROM messages WHERE message_id = ?").get(messageId);
    if (existing) {
      if (existing.sender_id !== senderId || existing.payload_hash !== payloadHash) {
        throw new IdempotencyConflictError("This message ID was already used with a different sender or payload.");
      }
      return { ...JSON.parse(existing.response_json), replayed: true };
    }
    const conversation = getOrCreateConversation(senderId);
    const result = processText(conversation, text);
    const response = {
      ...result,
      success: true,
      intent: intentForResult(result),
      senderId,
      sender_id: senderId,
      messageId,
      message_id: messageId,
      timestamp,
      conversationId: conversation.id,
      conversation_id: conversation.id,
      replayed: false
    };
    db.prepare(`
      INSERT INTO messages(message_id, sender_id, conversation_id, text, event_timestamp, payload_hash, response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, senderId, conversation.id, text, timestamp, payloadHash, JSON.stringify(response));
    const saveTranscript = db.prepare(`
      INSERT INTO conversation_messages(message_id, sender_id, conversation_id, direction, text, event_timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    saveTranscript.run(messageId, senderId, conversation.id, "incoming", text, timestamp);
    saveTranscript.run(messageId, senderId, conversation.id, "outgoing", response.reply, timestamp);
    return response;
  });
  return run();
}

export function getConversation(senderId) {
  const conversation = db.prepare("SELECT * FROM conversations WHERE sender_id = ?").get(senderId);
  if (!conversation) return null;
  const recentMessages = db.prepare(`
    SELECT message_id, text, event_timestamp, response_json
    FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(conversation.id).map((message) => ({
    messageId: message.message_id,
    incoming: message.text,
    reply: JSON.parse(message.response_json).reply,
    timestamp: message.event_timestamp
  }));
  const context = JSON.parse(conversation.context_json);
  return {
    senderId: conversation.sender_id,
    state: conversation.state,
    updatedAt: conversation.updated_at,
    cart: getCart(conversation.id),
    pendingAction: conversation.pending_action,
    preview: context.pending_preview || null,
    messages: recentMessages
  };
}

function quotationWithItems(quote) {
  if (!quote) return null;
  const items = db.prepare("SELECT product_id, product_name AS name, quantity, unit_price_paise, line_total_paise FROM quotation_items WHERE quotation_id = ?");
  return { ...quote, items: items.all(quote.id) };
}

export function listQuotations(senderId, page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const query = senderId
    ? db.prepare("SELECT * FROM quotations WHERE sender_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
    : db.prepare("SELECT * FROM quotations ORDER BY created_at DESC LIMIT ? OFFSET ?");
  const rows = senderId ? query.all(senderId, pageSize, offset) : query.all(pageSize, offset);
  return rows.map(quotationWithItems);
}

export function getQuotation(id) {
  return quotationWithItems(db.prepare("SELECT * FROM quotations WHERE id = ?").get(id));
}

export function listHandoffs(status) {
  const rows = status
    ? db.prepare("SELECT * FROM handoffs WHERE status = ? ORDER BY created_at DESC").all(status)
    : db.prepare("SELECT * FROM handoffs ORDER BY created_at DESC").all();
  return rows.map((row) => ({ ...row, context: JSON.parse(row.context_json) }));
}

export function updateHandoffStatus(id, status) {
  const result = db.prepare(`
    UPDATE handoffs SET status = ?,
      assigned_to = CASE WHEN ? = 'in_progress' THEN COALESCE(assigned_to, 'local-demo-operator') ELSE assigned_to END,
      resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id = ?
  `).run(status, status, status, id);
  if (!result.changes) return null;
  const row = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id);
  return { ...row, context: JSON.parse(row.context_json) };
}

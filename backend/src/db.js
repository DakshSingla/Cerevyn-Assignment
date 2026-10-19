import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT UNIQUE,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        price_paise INTEGER NOT NULL CHECK(price_paise >= 0),
        stock INTEGER NOT NULL CHECK(stock >= 0),
        aliases TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL DEFAULT 'active',
        pending_action TEXT,
        pending_data TEXT,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE carts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_confirmation', 'confirmed', 'cancelled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE cart_items (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        cart_id INTEGER REFERENCES carts(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price_paise INTEGER NOT NULL DEFAULT 0 CHECK(unit_price_paise >= 0),
        PRIMARY KEY(conversation_id, product_id)
      );
      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        conversation_id INTEGER REFERENCES conversations(id),
        text TEXT NOT NULL DEFAULT '',
        event_timestamp TEXT,
        payload_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processing_status TEXT NOT NULL DEFAULT 'processed',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
        text TEXT NOT NULL,
        event_timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, direction)
      );
      CREATE TABLE quotations (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        status TEXT NOT NULL DEFAULT 'confirmed',
        cart_id INTEGER REFERENCES carts(id),
        subtotal_paise INTEGER NOT NULL,
        tax_paise INTEGER NOT NULL,
        total_paise INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE quotation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_paise INTEGER NOT NULL,
        line_total_paise INTEGER NOT NULL
      );
      CREATE TABLE handoffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handoff_id TEXT UNIQUE,
        sender_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        reason TEXT NOT NULL,
        context_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_to TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        ,resolved_at TEXT
      );
      CREATE INDEX handoffs_status_idx ON handoffs(status, created_at);
      CREATE INDEX quotations_sender_idx ON quotations(sender_id, created_at);
      CREATE INDEX conversation_messages_history_idx ON conversation_messages(conversation_id, id);
    `
  },
  {
    version: 2,
    run() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS carts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_confirmation', 'confirmed', 'cancelled')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
          text TEXT NOT NULL,
          event_timestamp TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, direction)
        );
        CREATE INDEX IF NOT EXISTS conversation_messages_history_idx ON conversation_messages(conversation_id, id)
      `);
      const addColumn = (table, column, definition) => {
        const existing = db.pragma(`table_info(${table})`).some((item) => item.name === column);
        if (!existing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };

      // Hinglish: Existing local database ko bina customer data delete kiye evolve karte hain.
      addColumn("products", "sku", "TEXT");
      addColumn("products", "created_at", "TEXT");
      addColumn("products", "updated_at", "TEXT");
      addColumn("conversations", "pending_action", "TEXT");
      addColumn("conversations", "pending_data", "TEXT");
      addColumn("conversations", "created_at", "TEXT");
      addColumn("messages", "conversation_id", "INTEGER REFERENCES conversations(id)");
      addColumn("messages", "text", "TEXT NOT NULL DEFAULT ''");
      addColumn("messages", "event_timestamp", "TEXT");
      addColumn("messages", "processed_at", "TEXT");
      addColumn("messages", "processing_status", "TEXT NOT NULL DEFAULT 'processed'");
      addColumn("quotations", "enquiry_id", "TEXT");
      addColumn("quotations", "tax_rate_basis_points", "INTEGER NOT NULL DEFAULT 1800");
      addColumn("quotations", "cart_id", "INTEGER REFERENCES carts(id)");
      addColumn("handoffs", "handoff_id", "TEXT");
      addColumn("handoffs", "assigned_to", "TEXT");
      addColumn("handoffs", "resolved_at", "TEXT");
      addColumn("cart_items", "unit_price_paise", "INTEGER NOT NULL DEFAULT 0");
      addColumn("cart_items", "cart_id", "INTEGER REFERENCES carts(id)");

      db.exec(`
        CREATE TABLE IF NOT EXISTS carts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_confirmation', 'confirmed', 'cancelled')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON products(sku) WHERE sku IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS quotations_enquiry_id_unique ON quotations(enquiry_id) WHERE enquiry_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS handoffs_handoff_id_unique ON handoffs(handoff_id) WHERE handoff_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
      `);
      db.prepare("UPDATE products SET sku = id WHERE sku IS NULL").run();
      db.prepare("UPDATE products SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL").run();
      db.prepare("UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL").run();
      db.prepare("UPDATE conversations SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL").run();
      db.prepare(`
        UPDATE messages SET conversation_id = (
          SELECT id FROM conversations WHERE conversations.sender_id = messages.sender_id
        ) WHERE conversation_id IS NULL
      `).run();
      db.prepare("UPDATE messages SET processed_at = created_at WHERE processed_at IS NULL").run();
      db.prepare("UPDATE quotations SET enquiry_id = id WHERE enquiry_id IS NULL").run();
      db.prepare("UPDATE handoffs SET handoff_id = 'HO-' || id WHERE handoff_id IS NULL").run();

      const ensureCart = db.prepare("INSERT INTO carts(conversation_id, sender_id) VALUES (?, ?) ON CONFLICT(conversation_id) DO NOTHING");
      for (const conversation of db.prepare("SELECT id, sender_id FROM conversations").all()) {
        ensureCart.run(conversation.id, conversation.sender_id);
      }
      db.prepare(`
        UPDATE cart_items SET cart_id = (SELECT id FROM carts WHERE carts.conversation_id = cart_items.conversation_id),
          unit_price_paise = CASE WHEN unit_price_paise = 0
            THEN (SELECT price_paise FROM products WHERE products.id = cart_items.product_id)
            ELSE unit_price_paise END
        WHERE cart_id IS NULL OR unit_price_paise = 0
      `).run();
      db.prepare(`
        UPDATE quotations SET cart_id = (SELECT id FROM carts WHERE carts.conversation_id = quotations.conversation_id)
        WHERE cart_id IS NULL
      `).run();
    }
  },
  {
    version: 3,
    sql: `
      CREATE TABLE handoff_status_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handoff_id INTEGER NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE,
        previous_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX handoff_status_events_handoff_idx
        ON handoff_status_events(handoff_id, created_at);
    `
  }
];

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
for (const migration of migrations) {
  if (applied.has(migration.version)) continue;
  const apply = db.transaction(() => {
    if (migration.sql) db.exec(migration.sql);
    if (migration.run) migration.run();
    db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(migration.version);
  });
  apply();
}

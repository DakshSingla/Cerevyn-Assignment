import { db } from "./db.js";
import { products } from "./catalog.js";

const insert = db.prepare(`
  INSERT INTO products(id, name, sku, category, description, price_paise, stock, aliases)
  VALUES (@id, @name, @id, @category, @description, @price_paise, @stock, @aliases)
  ON CONFLICT(id) DO NOTHING
`);
const seed = db.transaction(() => {
  for (const product of products) insert.run({ ...product, aliases: JSON.stringify(product.aliases) });
});
seed();
console.log(`Seed complete: ${products.length} catalogue records available (existing records preserved).`);
db.close();

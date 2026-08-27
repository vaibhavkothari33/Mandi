import { db, nowIso } from '../lib/db/client.ts'
import { registerAgent } from '../lib/agents.ts'

const PRODUCTS = [
  ['sku_chai_250', 'Assam CTC Chai 250g', 'Strong malty leaf, single estate.', 'grocery', 24900, 40],
  ['sku_coffee_500', 'Filter Coffee Blend 500g', '80:20 arabica and chicory.', 'grocery', 54900, 25],
  ['sku_biscuit_pack', 'Butter Biscuits 400g', 'Bakery style, tin packed.', 'snacks', 18000, 60],
  ['sku_namkeen_mix', 'Bhujia Mix 350g', 'Bikaneri style, medium spice.', 'snacks', 12500, 80],
  ['sku_honey_500', 'Raw Forest Honey 500g', 'Unfiltered, single origin.', 'grocery', 47500, 18],
  ['sku_ghee_500', 'A2 Cow Ghee 500ml', 'Bilona method, glass jar.', 'grocery', 89900, 12],
  ['sku_mug_steel', 'Steel Chai Tumbler', 'Double wall, 180ml.', 'kitchen', 39900, 30],
  ['sku_press_french', 'French Press 600ml', 'Borosilicate with steel frame.', 'kitchen', 149900, 8],
] as const

const handle = db()
const stmt = handle.prepare(
  `INSERT INTO products (id, title, description, category, price_paise, currency, stock, updated_at)
   VALUES (?, ?, ?, ?, ?, 'INR', ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     title = excluded.title,
     description = excluded.description,
     category = excluded.category,
     price_paise = excluded.price_paise,
     stock = excluded.stock,
     updated_at = excluded.updated_at`,
)

for (const [id, title, description, category, price, stock] of PRODUCTS) {
  stmt.run(id, title, description, category, price, stock, nowIso())
}

registerAgent('agent_demo_buyer', 'Demo Buyer Agent', process.env.DEMO_AGENT_SECRET ?? 'demo_secret_do_not_use_in_production')

console.log(`seeded ${PRODUCTS.length} products, 1 agent`)

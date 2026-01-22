# Neon PostgreSQL

Polsia apps use Neon PostgreSQL. DATABASE_URL is automatically provided.

## Connection

```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

## Migrations

**IMPORTANT:** Always create migrations in the `migrations/` folder. Do NOT add migrations inline to `migrate.js`.

### Creating a Migration

1. Create a file in `migrations/` with timestamp prefix:
   ```
   migrations/1704067200000_add_products_table.js
   ```

2. Use this format:
   ```javascript
   module.exports = {
     name: 'add_products_table',
     up: async (client) => {
       await client.query(`
         CREATE TABLE products (
           id SERIAL PRIMARY KEY,
           name VARCHAR(255) NOT NULL,
           price DECIMAL(10,2),
           created_at TIMESTAMP DEFAULT NOW()
         )
       `);
     }
   };
   ```

3. The migration will run automatically on next deploy (via `npm run build`).

### Migration File Format

```javascript
// migrations/1704067200000_create_orders.js
module.exports = {
  name: 'create_orders',  // Human-readable name (tracked in _migrations table)
  up: async (client) => {
    // client is a pg Client with active connection
    await client.query(`
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        total DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Can run multiple queries
    await client.query(`
      CREATE INDEX orders_user_id_idx ON orders(user_id)
    `);
  }
};
```

### How It Works

- Migrations run on every deploy via `npm run build`
- Each migration runs once (tracked in `_migrations` table)
- Files are sorted by name (timestamp prefix ensures order)
- Each migration runs in a transaction (auto-rollback on error)

### Adding Columns to Existing Tables

```javascript
// migrations/1704153600000_add_status_to_orders.js
module.exports = {
  name: 'add_status_to_orders',
  up: async (client) => {
    await client.query(`
      ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending'
    `);
  }
};
```

### DO NOT

- Do NOT edit `migrate.js` to add new tables
- Do NOT use `CREATE TABLE IF NOT EXISTS` in migrations (each should run once)
- Do NOT add migrations inline to server.js

## Parameterized Queries (CRITICAL)

Always use parameterized queries to prevent SQL injection:

```javascript
// CORRECT
await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
await pool.query('INSERT INTO users (email, name) VALUES ($1, $2)', [email, name]);

// WRONG - SQL injection risk
await pool.query(`SELECT * FROM users WHERE id = ${userId}`);
```

## JSONB Arrays

Use the correct functions for JSONB:

```javascript
// CORRECT - jsonb_array_elements for JSONB arrays
await pool.query(`
  SELECT jsonb_array_elements_text(tags) as tag
  FROM posts
  WHERE id = $1
`, [postId]);

// WRONG - unnest doesn't work on JSONB
await pool.query(`SELECT unnest(tags) FROM posts`); // ERROR!
```

| Function | Use For |
|----------|---------|
| `jsonb_array_elements(col)` | Returns JSONB elements |
| `jsonb_array_elements_text(col)` | Returns TEXT elements |
| `unnest(col)` | Only native arrays, NOT JSONB |

## Common Patterns

### Upsert (Insert or Update)

```javascript
await pool.query(`
  INSERT INTO users (email, name, updated_at)
  VALUES ($1, $2, NOW())
  ON CONFLICT (email)
  DO UPDATE SET name = $2, updated_at = NOW()
`, [email, name]);
```

### Returning Inserted Row

```javascript
const result = await pool.query(`
  INSERT INTO users (email, name)
  VALUES ($1, $2)
  RETURNING *
`, [email, name]);

const newUser = result.rows[0];
```

### Transaction

```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO orders (user_id) VALUES ($1)', [userId]);
  await client.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [productId]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

## Agent Data Table

When using Agent SDK, data saved via `save_data()` goes to `agent_data`:

```javascript
// Query agent-saved data
const result = await pool.query(`
  SELECT id, type, data, created_at
  FROM agent_data
  WHERE type = $1
  ORDER BY created_at DESC
  LIMIT $2
`, ['trend', 10]);

// Data is JSONB, access fields directly
const trends = result.rows.map(r => ({
  id: r.id,
  ...r.data,
  created_at: r.created_at
}));
```

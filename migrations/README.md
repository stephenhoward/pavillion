# Database Migrations

This directory contains Sequelize database migrations for Pavillion.

## Migration Naming Convention

Migrations should be named using the following pattern:

```
NNNN_description.ts
```

Where:
- `NNNN` is a zero-padded sequential number (e.g., 0001, 0002, 0003)
- `description` is a brief, snake_case description of the migration

Examples:
- `0001_initial_schema.ts`
- `0002_add_user_preferences.ts`
- `0003_create_notifications_table.ts`

## Migration Structure

Each migration file should export an object with `up` and `down` functions:

```typescript
import { Sequelize, QueryInterface, DataTypes } from 'sequelize';

export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    // Migration logic here
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    // Rollback logic here
  },
};
```

## Running Migrations

Migrations are automatically run on production server startup before the application starts serving requests.

In development mode (`npm run dev`), the database is reset and re-seeded on each restart, so migrations are not used.

## Important Notes

1. **Never modify existing migrations** that have been run in production
2. **Always provide a down() method** for rollback capability
3. **Test migrations** against a copy of production data before deploying
4. **Keep migrations small** and focused on a single change
5. **Avoid data-dependent logic** that might fail on different database states

# Database Injection Prevention

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **SQL injection via `Sequelize.literal()`**: String interpolation inside `literal()` bypasses parameterization
- **Raw queries without replacements**: `sequelize.query()` with concatenated strings
- **Mass assignment**: Passing `req.body` directly to `Model.create()` or `Model.update()`
- **Operator injection**: User input used directly in Sequelize `Op` conditions (e.g., `Op.gt`, `Op.like`)
- **NaN in numeric queries**: `parseInt()` returning `NaN` passed to numeric WHERE clauses

## Safe Patterns

### Parameterized Queries

Always use Sequelize's built-in parameterization:

```typescript
// Safe: Sequelize handles parameterization
const events = await EventEntity.findAll({
  where: { calendar_id: calendarId }
});

// Safe: explicit replacements for raw queries
const results = await sequelize.query(
  'SELECT * FROM events WHERE calendar_id = :calendarId',
  { replacements: { calendarId }, type: QueryTypes.SELECT }
);
```

### Safe Use of `literal()`

Only use `literal()` with static SQL — never interpolate user input:

```typescript
// Safe: static SQL expression
EventEntity.findAll({
  order: [Sequelize.literal('"start_date" ASC')]
});

// Safe: literal with no user data
where: {
  [Op.and]: [Sequelize.literal('"start_date" >= NOW()')]
}
```

### Explicit Field Assignment

Never pass raw request body to create/update. Map fields explicitly:

```typescript
// Safe: explicit field mapping
const entity = CalendarEntity.build({
  id: uuidv4(),
  account_id: account.id,
  url_name: calendar.urlName,
  languages: calendar.languages,
});

// Safe: using fromModel() pattern
const entity = CalendarEntity.fromModel(calendarModel);
```

### Numeric Input Validation

```typescript
// Safe: default value on NaN
const page = parseInt(req.query.page as string) || 1;
const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
```

## Vulnerable Patterns

### String Interpolation in `literal()`

```typescript
// VULNERABLE: user input in literal SQL
const orderBy = req.query.sort;
EventEntity.findAll({
  order: [Sequelize.literal(`"${orderBy}" ASC`)]
});
// Attacker: ?sort=id" ASC; DROP TABLE events; --
```

### Raw Query Without Replacements

```typescript
// VULNERABLE: string concatenation in raw query
const results = await sequelize.query(
  `SELECT * FROM events WHERE title LIKE '%${searchTerm}%'`
);
```

### Mass Assignment

```typescript
// VULNERABLE: req.body passed directly
await CalendarEntity.create(req.body);
// Attacker can set account_id, is_admin, or any column

// VULNERABLE: spread operator with req.body
await entity.update({ ...req.body });
```

### Op Injection

```typescript
// VULNERABLE: user controls operator
const filter = req.body.filter;
// If filter = { "id": { "$gt": "" } }, this becomes Op.gt
await EventEntity.findAll({ where: filter });
```

## Known Codebase Patterns

- Entity `fromModel()` / `toModel()` pattern prevents mass assignment — see the `backend-entity-model` skill
- Services accept primitive values, not raw request bodies — see the `backend-domain-structure` skill
- Sequelize queries use Sequelize Op constants, not string operators
- SQLite used for testing, PostgreSQL for production — query behavior may differ between them

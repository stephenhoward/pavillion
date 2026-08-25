# Sequelize Query Patterns

Avoid N+1 queries by eagerly loading all needed relationships in the initial query.

## Always Eager Load

```typescript
// Good - single query with includes
const events = await EventEntity.findAll({
  where: { calendar_id: calendarId },
  include: [
    LocationEntity,
    EventScheduleEntity,
    MediaEntity,
    {
      model: EventCategoryAssignmentEntity,
      as: 'categoryAssignments', // Must match association alias
      include: [{ model: EventCategoryEntity, as: 'category' }],
    },
  ],
});

// Bad - causes N+1 queries
const events = await EventEntity.findAll({ where: { calendar_id: calendarId } });
for (const event of events) {
  const location = await event.getLocation(); // Extra query per event!
}
```

## Association Aliases

The `as` property in includes must match the alias defined in the model:

```typescript
// In entity definition
@HasMany(() => EventCategoryAssignmentEntity, { as: 'categoryAssignments' })

// In query - must use same alias
include: [{ model: EventCategoryAssignmentEntity, as: 'categoryAssignments' }]
```

## Filtering with Joins

```typescript
// Use required: true for INNER JOIN (filtering)
include: [{
  model: EventContentEntity,
  as: 'content',
  where: { title: { [Op.iLike]: `%${search}%` } },
  required: true, // Only return events matching this condition
}]

// Default (required: false) is LEFT JOIN (include nulls)
```

## Complex SQL

Use `literal()` for expressions Sequelize can't express:

```typescript
where: literal(`LOWER(title) LIKE LOWER('%${search}%')`)
```

## Transactions: Use the Managed Callback Form

Wrap multi-statement writes in Sequelize's managed (callback) transaction. Sequelize commits when the callback resolves and rolls back when it throws, rethrowing the original error:

```typescript
// Good - managed transaction; auto commit/rollback
const result = await db.transaction(async (transaction) => {
  await ChildEntity.destroy({ where: { parent_id: id }, transaction });
  await parentEntity.destroy({ transaction });
  return value; // becomes the db.transaction() result
});

// Bad - unmanaged try/commit/rollback boilerplate
const transaction = await db.transaction();
try {
  await parentEntity.destroy({ transaction });
  await transaction.commit();
}
catch (error) {
  await transaction.rollback(); // masks the original error if commit failed
  throw error;
}
```

The managed form is also safer at the edges: a failed `commit()` leaves the transaction finished, so the unmanaged form's `rollback()` throws a state error that masks the real failure, while the managed form rethrows the original error.

Rules:

- Never call `transaction.commit()` or `transaction.rollback()` inside the callback — Sequelize manages both, and an explicit call throws.
- Post-commit work (event bus emissions, federation side effects) goes after the `db.transaction()` call, not inside the callback. Return any values the post-commit code needs from the callback.
- Methods that accept an optional caller-supplied transaction should run the work in the caller's transaction when given one, and open a managed transaction otherwise (see `withTransaction` in `src/server/calendar/service/import/sync.ts`).

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

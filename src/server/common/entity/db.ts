import config from 'config';
import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

// tests
const db = new Sequelize( config.get('database') );

// production/ development
// new Sequelize('pavillion', 'username', 'password', {
//     host: 'localhost',
//     port: 5432,
//     dialect: 'postgres',
//     logging: console.log,
//     pool: {
//         max: 5,
//         min: 0,
//         acquire: 30000,
//         idle: 10000
//     }
//     });

// ISO date pattern for seed data (without timezone suffix)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;

/**
 * Find the earliest date in seed data to calculate shift offset.
 */
const findEarliestDate = (data: unknown): Date | null => {
  let earliest: Date | null = null;

  const scan = (value: unknown): void => {
    if (typeof value === 'string' && ISO_DATE_PATTERN.test(value)) {
      const date = new Date(value);
      if (!earliest || date < earliest) {
        earliest = date;
      }
    }
    else if (Array.isArray(value)) {
      value.forEach(scan);
    }
    else if (value && typeof value === 'object') {
      Object.values(value).forEach(scan);
    }
  };

  scan(data);
  return earliest;
};

/**
 * Shift all dates in seed data by offsetDays.
 */
const shiftDates = (data: unknown, offsetDays: number): unknown => {
  if (typeof data === 'string' && ISO_DATE_PATTERN.test(data)) {
    const date = new Date(data);
    date.setDate(date.getDate() + offsetDays);
    // Return in same format (without Z suffix)
    return date.toISOString().slice(0, -1);
  }
  else if (Array.isArray(data)) {
    return data.map(item => shiftDates(item, offsetDays));
  }
  else if (data && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = shiftDates(value, offsetDays);
    }
    return result;
  }
  return data;
};

export const seedDB = async () => {
  if ( process.env.NODE_ENV === "development" || process.env.NODE_ENV === "federation" || process.env.NODE_ENV === "e2e" ) {
    const seedPath = path.join(path.resolve(), "layouts/development/db");
    const files = await fs.readdir(seedPath);

    // First pass: load all data and find earliest date
    const allData: { file: string; data: unknown }[] = [];
    let globalEarliest: Date | null = null;

    for (const file of files.sort()) {
      // Skip non-JSON files
      if (!file.endsWith('.json')) {
        continue;
      }
      const content = await fs.readFile(path.join(seedPath, file), 'utf8');
      const data = JSON.parse(content);
      allData.push({ file, data });

      const earliest = findEarliestDate(data);
      if (earliest && (!globalEarliest || earliest < globalEarliest)) {
        globalEarliest = earliest;
      }
    }

    // Calculate offset: shift earliest date to 7 days before today
    // This ensures events are immediately visible in the default 2-week view
    let offsetDays = 0;
    if (globalEarliest) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - 7);

      const earliestTime = new Date(globalEarliest);
      earliestTime.setHours(0, 0, 0, 0);

      offsetDays = Math.round((targetDate.getTime() - earliestTime.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Second pass: seed with shifted dates
    for (const { data } of allData) {
      const shiftedData = offsetDays > 0 ? shiftDates(data, offsetDays) : data;
      await seedTable(shiftedData as object);
    }
  }
};

const seedTable = async (data: object) => {

  for (const [modelName, models] of Object.entries(data)) {
    const model = db.models[modelName];
    if ( model ) {
      await model.bulkCreate(models as object[]);
    }
  }
};

/**
 * Seeds follow relationships and category mappings between local calendars.
 *
 * Called after backfillCalendarActors so that CalendarActorEntity IDs are
 * available. Looks up actors by actor_uri rather than hard-coding generated
 * UUIDs. Idempotent — skips rows that already exist.
 *
 * Scenario seeded:
 *   test_calendar follows testuser_calendar with auto_repost_originals=true.
 *   Two of testuser_calendar's four categories are pre-mapped to test_calendar
 *   local categories; the other two are left unmapped to exercise the
 *   repost-categories modal.
 */
export const seedFollowData = async () => {
  if (process.env.NODE_ENV !== 'development') return;

  const domain: string = config.get('domain');

  // Look up the CalendarActorEntity for testuser_calendar (the followed calendar)
  const followedActor = await db.models['CalendarActorEntity'].findOne({
    where: { actor_uri: `https://${domain}/calendars/testuser_calendar` },
  }) as any;

  if (!followedActor) {
    console.warn('[seedFollowData] CalendarActor for testuser_calendar not found — skipping follow seed.');
    return;
  }

  // test_calendar (admin) follows testuser_calendar
  const followingCalendarId = 'cbe74815-939e-48b3-af44-1cd4eb3671bb'; // testuser_calendar
  const localCalendarId = 'c71f5c9e-7a3d-4e5f-8e1a-66c3612a05f3';   // test_calendar (admin)

  const existingFollow = await db.models['FollowingCalendarEntity'].findOne({
    where: {
      calendar_actor_id: followedActor.id,
      calendar_id: localCalendarId,
    },
  });

  let followId: string;
  if (!existingFollow) {
    followId = uuidv4();
    await db.models['FollowingCalendarEntity'].create({
      id: followId,
      calendar_actor_id: followedActor.id,
      calendar_id: localCalendarId,
      auto_repost_originals: true,
      auto_repost_reposts: false,
    });
  }
  else {
    followId = (existingFollow as any).id;
  }

  // Seed partial category mappings:
  //   testuser_calendar "Music"   → test_calendar "Entertainment"
  //   testuser_calendar "Film"    → test_calendar "Arts"
  //   "Outdoors" and "Food & Drink" intentionally left unmapped
  const mappings = [
    {
      source_category_id: 'd1000001-0000-0000-0000-000000000001',
      source_category_name: 'Music',
      local_category_id: '7ebf16ff-c570-4e5d-ab56-e289693cdb7e', // Entertainment
    },
    {
      source_category_id: 'd1000001-0000-0000-0000-000000000002',
      source_category_name: 'Film',
      local_category_id: 'bd18b4d9-32a5-4c8b-a6e2-0ffd62e5535a', // Arts
    },
  ];

  for (const m of mappings) {
    const exists = await db.models['CalendarCategoryMappingEntity'].findOne({
      where: {
        following_calendar_id: localCalendarId,
        source_calendar_actor_id: followedActor.id,
        source_category_id: m.source_category_id,
      },
    });
    if (!exists) {
      await db.models['CalendarCategoryMappingEntity'].create({
        id: uuidv4(),
        following_calendar_id: localCalendarId,
        source_calendar_actor_id: followedActor.id,
        source_category_id: m.source_category_id,
        source_category_name: m.source_category_name,
        local_category_id: m.local_category_id,
      });
    }
  }
};

export default db;

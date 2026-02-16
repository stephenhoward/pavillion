import config from 'config';
import { Sequelize } from 'sequelize-typescript';
import path from 'path';
import fs from 'fs/promises';

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

export default db;

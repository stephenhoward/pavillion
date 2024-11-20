import config from 'config';
import { Model, Sequelize } from 'sequelize-typescript';
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

export const seedDB = async () => {
    if ( process.env.NODE_ENV === "development" ) {
        const seedPath = path.join(path.resolve(), "layouts/development/db");
        let  files = await fs.readdir(seedPath);

        for (const file of files.sort() ) {
            const data = await fs.readFile(path.join(seedPath, file), 'utf8');
            await seedTable(JSON.parse(data));
        }
    }
};

const seedTable = async (data: object) => {
    
    for (const [modelName, models] of Object.entries(data)) {
        const model = db.models[modelName];
        if ( model ) {
            await model.bulkCreate(models);
        }
    }
};

export default db;
import { Model, Sequelize } from 'sequelize';

// tests
const db = new Sequelize({
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false
  });

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


export default db;
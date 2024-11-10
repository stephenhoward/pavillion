import { Sequelize, DataTypes } from 'sequelize';

const sequelize = new Sequelize('sqlite::memory');

const Location = sequelize.define('location', { 
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    name: DataTypes.STRING,
    address: DataTypes.STRING,
    address2: DataTypes.STRING,
    city: DataTypes.STRING,
    state: DataTypes.STRING,
    postal_code: DataTypes.STRING,
    country: DataTypes.STRING,
});

export {
    Location
};
import { Sequelize, DataTypes } from 'sequelize';

const sequelize = new Sequelize('sqlite::memory');

const EventEntity = sequelize.define('event', { 
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
});

const EventContentEntity = sequelize.define('event_content', {  
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    language: DataTypes.STRING,
    name: DataTypes.STRING,
    description: DataTypes.STRING,
});

const EventScheduleEntity = sequelize.define('event_schedule', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    timezone: DataTypes.STRING,
    start_date: DataTypes.DATE,
    end_date: DataTypes.DATE,
    frequency: DataTypes.STRING,
    interval: DataTypes.INTEGER,
    count: DataTypes.INTEGER,
    by_setpos: DataTypes.INTEGER,
    by_month: DataTypes.INTEGER,
    by_monthday: DataTypes.INTEGER,
    by_year_day: DataTypes.INTEGER,
    by_week_no: DataTypes.INTEGER,
    by_weekday: DataTypes.INTEGER,
    by_hour: DataTypes.INTEGER,
    by_minute: DataTypes.INTEGER,
    by_second: DataTypes.INTEGER,
});

EventEntity.hasMany(EventContentEntity, {foreignKey: 'event_id'});
EventEntity.hasMany(EventScheduleEntity, {foreignKey: 'event_id'});
EventEntity.belongsTo(EventEntity, {foreignKey: 'parent_event_id'});

export {
    EventEntity,
    EventContentEntity,
    EventScheduleEntity
};
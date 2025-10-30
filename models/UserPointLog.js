// models/UserPointLog.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('./User');

const UserPointLog = sequelize.define('UserPointLog', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    delta: { type: DataTypes.INTEGER, allowNull: false },        // কত পয়েন্ট যোগ/বিয়োগ (+/-)
    reason: { type: DataTypes.STRING(100), allowNull: true },     // e.g. "level_clear", "bonus"
    sessionId: { type: DataTypes.STRING(64), allowNull: true },   // গেম সেশন/ম্যাচ আইডি (যদি থাকে)
    meta: { type: DataTypes.JSON, allowNull: true }               // extra payload (e.g., {level:3})
}, {
    tableName: 'user_point_logs',
    underscored: true,
    indexes: [
        { fields: ['user_id', 'created_at'] }, // history query দ্রুত হবে
    ]
});

UserPointLog.belongsTo(User, { foreignKey: 'userId' });

module.exports = UserPointLog;

// models/UserPoint.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('./User');

const UserPoint = sequelize.define('UserPoint', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    totalPoints: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastPlayedAt: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: 'user_points',
    underscored: true,
    indexes: [
        { fields: ['total_points'] }, // leaderboard sort
        { unique: true, fields: ['user_id'] }
    ]
});

// (optional) association
UserPoint.belongsTo(User, { foreignKey: 'userId' });

module.exports = UserPoint;

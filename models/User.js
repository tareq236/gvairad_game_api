// models/User.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    mobile: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120) },
    doctorName: { type: DataTypes.STRING(120), allowNull: true },
    doctorRplId: { type: DataTypes.STRING(80), allowNull: true, unique: true },
    mioId: { type: DataTypes.STRING(80), allowNull: true, unique: true },
    territory: { type: DataTypes.STRING(32), allowNull: true },
    instituteName: { type: DataTypes.STRING(120), allowNull: true },
    verifiedAt: { type: DataTypes.DATE },
    registeredAt: { type: DataTypes.DATE },
    lastLoginAt: { type: DataTypes.DATE }
}, {
    tableName: 'users',
    underscored: true
});

module.exports = User;

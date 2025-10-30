// models/User.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    mobile: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(80) },
    email: { type: DataTypes.STRING(120) },
    gender: { type: DataTypes.STRING(10) },    // 'male' | 'female' | etc.
    dob: { type: DataTypes.DATEONLY },
    address: { type: DataTypes.STRING(255) },
    verifiedAt: { type: DataTypes.DATE }
}, {
    tableName: 'users',
    underscored: true
});

module.exports = User;

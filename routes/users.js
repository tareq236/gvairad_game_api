// routes/users.js
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const User = require('../models/User');
const { Op } = require('sequelize');

const serializeUser = (user) => {
    if (!user) return null;

    return {
        id: user.id,
        mobile: user.mobile,
        phoneNumber: user.mobile,
        name: user.name,
        doctorName: user.doctorName || user.name,
        doctorRplId: user.doctorRplId,
        mioId: user.mioId,
        territory: user.territory,
        instituteName: user.instituteName,
        verifiedAt: user.verifiedAt,
        registeredAt: user.registeredAt,
        lastLoginAt: user.lastLoginAt
    };
};

const normalizeCandidates = (mobile) => {
    const raw = (mobile || '').trim();
    const digits = raw.replace(/\D/g, '');
    const set = new Set([raw, digits]);

    if (/^0\d{10}$/.test(digits)) {
        set.add('880' + digits.slice(1));     // 019xxxx -> 88019xxxx
        set.add('+880' + digits.slice(1));    // +88019xxxx
    }
    if (/^880\d{9,}$/.test(digits)) {
        const local = '0' + digits.slice(3);  // 88019xxxx -> 019xxxx
        set.add(local);
        set.add('+' + digits);                // +88019xxxx
    }
    if (/^1\d{9}$/.test(digits)) {
        const local = '0' + digits;           // 1xxxxxxxxx -> 01xxxxxxxxx
        set.add(local);
        set.add('880' + local.slice(1));
        set.add('+880' + local.slice(1));
    }
    return [...set].filter(Boolean);
};

// POST /users/upsert
router.post('/upsert', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).required(),
            name: Joi.string().allow('', null),

            // NEW: territory mandatory, only digits, length >= 5
            territory: Joi.string().pattern(/^\d{5,}$/).required(),

            // NEW: optional
            instituteName: Joi.string().max(120).allow('', null)
        }).validate(req.body, { stripUnknown: true });

        if (error) return res.status(400).json({ ok: false, message: error.message });

        const { mobile, name, territory, instituteName } = value;

        let user = await User.findOne({ where: { mobile } });
        const created = !user;

        if (created) {
            user = await User.create({
                mobile,
                name: name || null,
                territory,
                instituteName: instituteName || null,
                verifiedAt: new Date()
            });
        } else {
            await user.update({
                name: name || null,
                territory,
                instituteName: instituteName || null
            });
        }

        res.json({
            ok: true,
            created,
            user: serializeUser(user)
        });
    } catch (e) { next(e); }
});

// GET /users/by-mobile?mobile=...
router.get('/by-mobile', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).required()
        }).validate(req.query);
        if (error) return res.status(400).json({ ok: false, message: error.message });

        const user = await User.findOne({
            where: { mobile: { [Op.in]: normalizeCandidates(value.mobile) } }
        });

        return res.json({
            ok: true,
            user: serializeUser(user)
        });
    } catch (e) { next(e); }
});

module.exports = router;

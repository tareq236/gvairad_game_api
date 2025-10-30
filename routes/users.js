// routes/users.js
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const User = require('../models/User');
const { Op } = require('sequelize');

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
            name: Joi.string().allow(null, ''),
            email: Joi.string().email().allow(null, ''),
            gender: Joi.string().valid('male','female','other').allow(null, ''),
            dob: Joi.date().allow(null),
            address: Joi.string().allow(null, '')
        }).validate(req.body, { stripUnknown: true });

        if (error) return res.status(400).json({ ok: false, message: error.message });

        const { mobile, ...rest } = value;

        let user = await User.findOne({ where: { mobile } });
        const created = !user;

        if (created) {
            user = await User.create({ mobile, ...rest, verifiedAt: new Date() });
        } else {
            await user.update(rest);
        }

        res.json({
            ok: true,
            created,
            user: {
                id: user.id,
                mobile: user.mobile,
                name: user.name,
                email: user.email,
                gender: user.gender,
                dob: user.dob,
                address: user.address,
                verifiedAt: user.verifiedAt
            }
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

        const candidates = normalizeCandidates(value.mobile);

        const user = await User.findOne({
            where: { mobile: { [Op.in]: candidates } }
        });

        return res.json({
            ok: true,
            user: user ? {
                id: user.id,
                mobile: user.mobile,
                name: user.name,
                email: user.email,
                gender: user.gender,
                dob: user.dob,
                address: user.address,
                verifiedAt: user.verifiedAt
            } : null
        });
    } catch (e) { next(e); }
});

module.exports = router;

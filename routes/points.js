// routes/points.js
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { Op, QueryTypes } = require('sequelize');

const sequelize = require('../config/db');
const User = require('../models/User');
const UserPoint = require('../models/UserPoint');
const UserPointLog = require('../models/UserPointLog');

// -----------------------------
// Helper: normalize BD numbers
// -----------------------------
const normalizeCandidates = (mobile) => {
    const raw = (mobile || '').trim();
    const digits = raw.replace(/\D/g, '');
    const set = new Set([raw, digits]);

    // 019xxxxxxxx -> 88019xxxxxxxx / +88019xxxxxxxx
    if (/^0\d{10}$/.test(digits)) {
        set.add('880' + digits.slice(1));
        set.add('+880' + digits.slice(1));
    }
    // 88019xxxxxxxx -> 019xxxxxxxx / +88019xxxxxxxx
    if (/^880\d{9,}$/.test(digits)) {
        const local = '0' + digits.slice(3);
        set.add(local);
        set.add('+' + digits);
    }
    // 1xxxxxxxxx -> 01xxxxxxxxx / 8801xxxxxxxxx / +8801xxxxxxxxx
    if (/^1\d{9}$/.test(digits)) {
        const local = '0' + digits;
        set.add(local);
        set.add('880' + local.slice(1));
        set.add('+880' + local.slice(1));
    }
    return [...set].filter(Boolean);
};

// ---------------------------------------------------
// POST /points/add
// Body: { mobile: string, points: int>0, reason?, sessionId?, meta? }
// - Increments user's totalPoints
// - Updates lastScore + lastPlayedAt
// - Writes a history log entry
// ---------------------------------------------------
router.post('/add', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).required(),
            points: Joi.number().integer().min(1).max(10_000_000).required(),
            reason: Joi.string().max(100).allow('', null),
            sessionId: Joi.string().max(64).allow('', null),
            meta: Joi.object().unknown(true).allow(null)
        }).validate(req.body, { stripUnknown: true });
        if (error) return res.status(400).json({ ok: false, message: error.message });

        const candidates = normalizeCandidates(value.mobile);
        const user = await User.findOne({ where: { mobile: { [Op.in]: candidates } } });
        if (!user) return res.status(404).json({ ok: false, message: 'User not found for given mobile' });

        const now = new Date();
        let up;

        await sequelize.transaction(async (t) => {
            // ensure a points row
            [up] = await UserPoint.findOrCreate({
                where: { userId: user.id },
                defaults: { userId: user.id, totalPoints: 0, lastScore: 0, lastPlayedAt: now },
                transaction: t
            });

            // increment totals
            await UserPoint.increment(
                { totalPoints: value.points },
                { where: { userId: user.id }, transaction: t }
            );

            // update last score/play time
            await UserPoint.update(
                { lastScore: value.points, lastPlayedAt: now },
                { where: { userId: user.id }, transaction: t }
            );

            // history log
            await UserPointLog.create({
                userId: user.id,
                delta: value.points,
                reason: value.reason || null,
                sessionId: value.sessionId || null,
                meta: value.meta || null
            }, { transaction: t });
        });

        up = await UserPoint.findOne({ where: { userId: user.id } });

        return res.json({
            ok: true,
            user: { id: user.id, name: user.name, mobile: user.mobile },
            points: {
                totalPoints: up.totalPoints,
                lastScore: up.lastScore,
                lastPlayedAt: up.lastPlayedAt
            }
        });
    } catch (e) { next(e); }
});

// ---------------------------------------------------
// GET /points/leaderboard?limit=50&offset=0
// - Top users by totalPoints desc
// - Tie-breaker: older updatedAt ranks higher
// ---------------------------------------------------
// REPLACE ONLY the /points/leaderboard handler in routes/points.js with this:

router.get('/leaderboard', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            limit: Joi.number().integer().min(1).max(100).default(50),
            offset: Joi.number().integer().min(0).default(0),
            mobile: Joi.string().min(6).max(20).allow('', null),
            userId: Joi.number().integer().allow(null)
        }).validate(req.query, { stripUnknown: true });
        if (error) return res.status(400).json({ ok: false, message: error.message });

        const limit  = value.limit;
        const offset = value.offset;

        // 1) Leaderboard list (same as before)
        const rows = await UserPoint.findAll({
            include: [{ model: User, attributes: ['id', 'name', 'mobile'] }],
            order: [
                ['totalPoints', 'DESC'],
                ['updatedAt', 'ASC'] // tie-breaker: older updatedAt ranks higher
            ],
            limit,
            offset
        });

        const results = rows.map((r, i) => ({
            rank: offset + i + 1,
            user: {
                id: r.User?.id,
                name: r.User?.name || null,
                mobile: r.User?.mobile || null
            },
            totalPoints: r.totalPoints,
            lastScore: r.lastScore,
            lastPlayedAt: r.lastPlayedAt
        }));

        // 2) Optional: compute "my_point" if mobile/userId provided
        let my_point = null;
        if (value.userId || (value.mobile && value.mobile.trim() !== '')) {
            // resolve user
            let me = null;
            if (value.userId) {
                me = await User.findByPk(value.userId);
            } else {
                const candidates = normalizeCandidates(value.mobile);
                me = await User.findOne({ where: { mobile: { [Op.in]: candidates } } });
            }
            if (!me) return res.status(404).json({ ok: false, message: 'User not found for given identifier' });

            const up = await UserPoint.findOne({ where: { userId: me.id } });
            if (!up) {
                my_point = {
                    user: { id: me.id, name: me.name, mobile: me.mobile },
                    points: { totalPoints: 0, lastScore: 0, lastPlayedAt: null },
                    rank: null
                };
            } else {
                const [rankRow] = await sequelize.query(
                    `SELECT 1 + COUNT(*) AS rank
           FROM user_points
           WHERE total_points > :tp
              OR (total_points = :tp AND updated_at < :upd)`,
                    {
                        replacements: { tp: up.totalPoints, upd: up.updatedAt },
                        type: QueryTypes.SELECT
                    }
                );
                my_point = {
                    user: { id: me.id, name: me.name, mobile: me.mobile },
                    points: {
                        totalPoints: up.totalPoints,
                        lastScore: up.lastScore,
                        lastPlayedAt: up.lastPlayedAt
                    },
                    rank: Number(rankRow?.rank ?? 1)
                };
            }
        }

        return res.json({ ok: true, count: results.length, results, my_point });
    } catch (e) { next(e); }
});

// ---------------------------------------------------
// GET /points/me?mobile=019xxxxxxx
// - Returns user's totals + computed rank
// rank = 1 + users with higher totalPoints
//        OR same totalPoints but older updated_at
// ---------------------------------------------------
router.get('/me', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).required()
        }).validate(req.query);
        if (error) return res.status(400).json({ ok: false, message: error.message });

        const candidates = normalizeCandidates(value.mobile);
        const user = await User.findOne({ where: { mobile: { [Op.in]: candidates } } });
        if (!user) return res.status(404).json({ ok: false, message: 'User not found for given mobile' });

        const up = await UserPoint.findOne({ where: { userId: user.id } });
        if (!up) {
            return res.json({
                ok: true,
                user: { id: user.id, name: user.name, mobile: user.mobile },
                points: { totalPoints: 0, lastScore: 0, lastPlayedAt: null },
                rank: null
            });
        }

        const [rankRow] = await sequelize.query(
            `SELECT 1 + COUNT(*) AS rank
       FROM user_points
       WHERE total_points > :tp
          OR (total_points = :tp AND updated_at < :upd)`,
            {
                replacements: { tp: up.totalPoints, upd: up.updatedAt },
                type: QueryTypes.SELECT
            }
        );

        return res.json({
            ok: true,
            user: { id: user.id, name: user.name, mobile: user.mobile },
            points: {
                totalPoints: up.totalPoints,
                lastScore: up.lastScore,
                lastPlayedAt: up.lastPlayedAt
            },
            rank: Number(rankRow?.rank ?? 1)
        });
    } catch (e) { next(e); }
});

// ------------------------------------------------------------------
// GET /points/history?mobile=...&userId=...&start=YYYY-MM-DD&end=YYYY-MM-DD&reason=bonus
// - Lists full point change logs (latest first) without pagination
// - Response includes totalPoints for the user
// ------------------------------------------------------------------
router.get('/history', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).allow(null, ''),
            userId: Joi.number().integer().allow(null),
            start: Joi.date().allow(null),
            end: Joi.date().allow(null),
            reason: Joi.string().max(100).allow(null, '')
        }).validate(req.query, { stripUnknown: true });
        if (error) return res.status(400).json({ ok: false, message: error.message });

        // resolve user
        let user = null;
        if (value.userId) {
            user = await User.findByPk(value.userId);
        } else if (value.mobile) {
            const candidates = normalizeCandidates(value.mobile);
            user = await User.findOne({ where: { mobile: { [Op.in]: candidates } } });
        } else {
            return res.status(400).json({ ok: false, message: 'Provide mobile or userId' });
        }
        if (!user) return res.status(404).json({ ok: false, message: 'User not found' });

        const where = { userId: user.id };
        if (value.reason) where.reason = value.reason;

        // inclusive date range on createdAt
        if (value.start || value.end) {
            const start = value.start ? new Date(value.start) : new Date('1970-01-01');
            const end = value.end ? new Date(value.end) : new Date('2999-12-31');
            end.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [start, end] };
        }

        // fetch all logs (no pagination)
        const rows = await UserPointLog.findAll({
            where,
            order: [['createdAt', 'DESC']]
        });

        // user's total points
        const up = await UserPoint.findOne({ where: { userId: user.id } });
        const totalPoints = up ? up.totalPoints : 0;

        const results = rows.map(r => ({
            id: r.id,
            delta: r.delta,
            reason: r.reason,
            sessionId: r.sessionId,
            meta: r.meta,
            createdAt: r.createdAt
        }));

        return res.json({
            ok: true,
            user: { id: user.id, name: user.name, mobile: user.mobile },
            totalPoints,
            results
        });
    } catch (e) { next(e); }
});

module.exports = router;

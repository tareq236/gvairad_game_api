// routes/auth.js
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const dayjs = require('dayjs');
const Otp = require('../models/Otp');
const User = require('../models/User');
const { parseStringPromise } = require('xml2js');

const normalizeMsisdn = (mobile) => {
    const digits = (mobile || '').replace(/\D/g, '');
    // if it starts with 0 and is 11 digits (e.g., 019xxxxxxx) -> make 88019...
    if (/^0\d{10}$/.test(digits)) return '88' + digits;
    // if it already starts with 880... keep it
    if (/^880\d{9,}$/.test(digits)) return digits;
    // if it starts with 1 and length 10/11 -> assume BD mobile
    if (/^1\d{9}$/.test(digits)) return '880' + digits;
    return digits; // fallback
};

const sendOtp = async (mobile, code) => {
    const ttl = Number(process.env.OTP_TTL_MINUTES || 5);
    const msisdn = normalizeMsisdn(mobile);

    const params = new URLSearchParams({
        Username: process.env.MOBIREACH_USERNAME,
        Password: process.env.MOBIREACH_PASSWORD,
        From: process.env.MOBIREACH_FROM || 'Impala',
        To: msisdn,
        Message: `Your OTP is ${code}. It will expire in ${ttl} minutes.`
    });

    const url = `https://api.mobireach.com.bd/SendTextMessage?${params.toString()}`;

    // Node 18+ has global fetch (you’re on v22) – no extra dep needed
    const resp = await fetch(url, { method: 'GET' });
    const xml = await resp.text();

    // Parse the XML and validate success
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    const svc = parsed?.ArrayOfServiceClass?.ServiceClass || {};
    const status = String(svc.Status ?? '');
    const statusText = svc.StatusText || '';
    if (status !== '0' || statusText.toLowerCase() !== 'success') {
        const errText = svc.ErrorText || 'Unknown error';
        throw new Error(`MobiReach failed: status=${status} (${statusText}) ${errText}`);
    }

    return {
        messageId: svc.MessageId,
        currentCredit: svc.CurrentCredit
    };
};

router.post('/send-otp', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).required()
        }).validate(req.body);
        if (error) return res.status(400).json({ ok: false, message: error.message });

        const { mobile } = value;
        const code = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
        const ttl = Number(process.env.OTP_TTL_MINUTES || 5);
        const expiresAt = dayjs().add(ttl, 'minute').toDate();

        await Otp.create({ mobile, code, expiresAt });
        await sendOtp(mobile, code);

        res.json({ ok: true, message: 'OTP sent', ttlMinutes: ttl });
    } catch (e) { next(e); }
});

router.post('/verify-otp', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            mobile: Joi.string().min(6).max(20).required(),
            code: Joi.string().length(4).required()
        }).validate(req.body);
        if (error) return res.status(400).json({ ok: false, message: error.message });

        const { mobile, code } = value;

        const otp = await Otp.findOne({
            where: { mobile, code, consumedAt: null },
            order: [['id', 'DESC']]
        });

        if (!otp) return res.status(400).json({ ok: false, message: 'Invalid OTP' });
        if (dayjs(otp.expiresAt).isBefore(dayjs())) {
            return res.status(400).json({ ok: false, message: 'OTP expired' });
        }

        // consume
        otp.consumedAt = new Date();
        await otp.save();

        // if user exists return it; else null
        const user = await User.findOne({ where: { mobile } });
        if (user && !user.verifiedAt) {
            user.verifiedAt = new Date();
            await user.save();
        }

        res.json({
            ok: true,
            verified: true,
            userAvailable: !!user,
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

// routes/auth.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Joi = require('joi');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const Otp = require('../models/Otp');
const User = require('../models/User');
const { parseStringPromise } = require('xml2js');

const GLOBAL_PASSWORD = process.env.GLOBAL_AUTH_PASSWORD || 'rofuclav';
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'doctor_auth';
const COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET || 'gvairad-doctor-auth';

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

const normalizeCandidates = (mobile) => {
    const raw = (mobile || '').trim();
    const digits = raw.replace(/\D/g, '');
    const set = new Set([raw, digits]);

    if (/^0\d{10}$/.test(digits)) {
        set.add('880' + digits.slice(1));
        set.add('+880' + digits.slice(1));
    }
    if (/^880\d{9,}$/.test(digits)) {
        const local = '0' + digits.slice(3);
        set.add(local);
        set.add('+' + digits);
    }
    if (/^1\d{9}$/.test(digits)) {
        const local = '0' + digits;
        set.add(local);
        set.add('880' + local.slice(1));
        set.add('+880' + local.slice(1));
    }

    return [...set].filter(Boolean);
};

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

const signPayload = (payload) => crypto
    .createHmac('sha256', COOKIE_SECRET)
    .update(payload)
    .digest('hex');

const createAuthToken = (user) => {
    const payload = JSON.stringify({
        id: user.id,
        mobile: user.mobile,
        exp: dayjs().add(30, 'day').unix()
    });
    const encoded = Buffer.from(payload).toString('base64url');
    return `${encoded}.${signPayload(encoded)}`;
};

const readAuthToken = (token) => {
    if (!token || !token.includes('.')) return null;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
    if (signPayload(encoded) !== signature) return null;

    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!payload?.exp || dayjs.unix(payload.exp).isBefore(dayjs())) return null;
        return payload;
    } catch (err) {
        return null;
    }
};

const setAuthCookie = (res, user) => {
    res.cookie(COOKIE_NAME, createAuthToken(user), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000
    });
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

router.post('/register', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            doctorName: Joi.string().trim().min(2).max(120).required(),
            doctorRplId: Joi.string().trim().min(2).max(80).required(),
            phoneNumber: Joi.string().trim().min(6).max(20).required(),
            mioId: Joi.string().trim().min(2).max(80).required(),
            password: Joi.string().required()
        }).validate(req.body, { stripUnknown: true });

        if (error) return res.status(400).json({ ok: false, message: error.message });
        if (value.password !== GLOBAL_PASSWORD) {
            return res.status(401).json({ ok: false, message: 'Invalid global password' });
        }

        const normalizedPhone = normalizeMsisdn(value.phoneNumber);
        const existingByPhone = await User.findOne({
            where: { mobile: { [Op.in]: normalizeCandidates(normalizedPhone) } }
        });
        const existingByRpl = await User.findOne({ where: { doctorRplId: value.doctorRplId } });
        const existingByMio = await User.findOne({ where: { mioId: value.mioId } });

        if (existingByRpl && (!existingByPhone || existingByRpl.id !== existingByPhone.id)) {
            return res.status(409).json({ ok: false, message: 'Doctor RPL ID already registered' });
        }
        if (existingByMio && (!existingByPhone || existingByMio.id !== existingByPhone.id)) {
            return res.status(409).json({ ok: false, message: 'MIO ID already registered' });
        }

        const now = new Date();
        let user = existingByPhone;
        const created = !user;

        if (created) {
            user = await User.create({
                mobile: normalizedPhone,
                name: value.doctorName,
                doctorName: value.doctorName,
                doctorRplId: value.doctorRplId,
                mioId: value.mioId,
                verifiedAt: now,
                registeredAt: now,
                lastLoginAt: now
            });
        } else {
            await user.update({
                mobile: normalizedPhone,
                name: value.doctorName,
                doctorName: value.doctorName,
                doctorRplId: value.doctorRplId,
                mioId: value.mioId,
                verifiedAt: user.verifiedAt || now,
                registeredAt: user.registeredAt || now,
                lastLoginAt: now
            });
        }

        setAuthCookie(res, user);

        return res.json({
            ok: true,
            created,
            message: created ? 'Registration successful' : 'Registration details updated',
            user: serializeUser(user)
        });
    } catch (e) {
        next(e);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const { error, value } = Joi.object({
            phoneNumber: Joi.string().trim().min(6).max(20).required(),
            password: Joi.string().required()
        }).validate(req.body, { stripUnknown: true });

        if (error) return res.status(400).json({ ok: false, message: error.message });
        if (value.password !== GLOBAL_PASSWORD) {
            return res.status(401).json({ ok: false, message: 'Invalid global password' });
        }

        const user = await User.findOne({
            where: { mobile: { [Op.in]: normalizeCandidates(value.phoneNumber) } }
        });

        if (!user) return res.status(404).json({ ok: false, message: 'Doctor not found' });

        user.lastLoginAt = new Date();
        await user.save();
        setAuthCookie(res, user);

        return res.json({
            ok: true,
            message: 'Login successful',
            user: serializeUser(user)
        });
    } catch (e) {
        next(e);
    }
});

router.post('/logout', async (req, res, next) => {
    try {
        res.clearCookie(COOKIE_NAME);
        return res.json({ ok: true, message: 'Logged out' });
    } catch (e) {
        next(e);
    }
});

router.get('/me', async (req, res, next) => {
    try {
        const payload = readAuthToken(req.cookies?.[COOKIE_NAME]);
        if (!payload?.id) {
            return res.status(401).json({ ok: false, message: 'Not logged in' });
        }

        const user = await User.findByPk(payload.id);
        if (!user) {
            res.clearCookie(COOKIE_NAME);
            return res.status(401).json({ ok: false, message: 'Invalid session' });
        }

        return res.json({ ok: true, user: serializeUser(user) });
    } catch (e) {
        next(e);
    }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      mobile: Joi.string().min(6).max(20).required(),
      code: Joi.string().length(4).required()
    }).validate(req.body);

    if (error) return res.status(400).json({ ok: false, message: error.message });

    const { mobile, code } = value;

    const allowTestBypass =
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_TEST_OTP === 'true' &&
      code === '4444';

    // In bypass mode, accept the latest unconsumed OTP for that mobile (must exist)
    const otp = await Otp.findOne({
      where: allowTestBypass
        ? { mobile, consumedAt: null }
        : { mobile, code, consumedAt: null },
      order: [['id', 'DESC']]
    });

    if (!otp) return res.status(400).json({ ok: false, message: 'Invalid OTP' });

    // Keep expiry check even in bypass mode (recommended)
    if (dayjs(otp.expiresAt).isBefore(dayjs())) {
      return res.status(400).json({ ok: false, message: 'OTP expired' });
    }

    otp.consumedAt = new Date();
    await otp.save();

    const user = await User.findOne({ where: { mobile } });
    if (user && !user.verifiedAt) {
      user.verifiedAt = new Date();
      await user.save();
    }

    return res.json({
      ok: true,
      verified: true,
      userAvailable: !!user,
      user: serializeUser(user)
    });
  } catch (e) {
    next(e);
  }
});


module.exports = router;

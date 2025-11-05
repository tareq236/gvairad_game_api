// app.js
require('dotenv').config();

var createError   = require('http-errors');
var express       = require('express');
var path          = require('path');
var cookieParser  = require('cookie-parser');
var logger        = require('morgan');
const cors        = require('cors');

// --- DB (Sequelize) ---
const sequelize = require('./config/db');
require('./models/User');
require('./models/Otp');
require('./models/UserPoint');
require('./models/UserPointLog');

// --- Routers ---
var indexRouter   = require('./routes/index');
var usersRouter   = require('./routes/users');   // /users/upsert, /users/by-mobile
var authRouter    = require('./routes/auth');    // /auth/send-otp, /auth/verify-otp
var pointsRouter  = require('./routes/points');  // /points/*

var app = express();

// ---------- CORS (keep this BEFORE other middlewares/routes) ----------
const allowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// For quick dev, you can set CORS_ORIGINS empty -> allow all
const corsOptions = {
    origin: function (origin, cb) {
        // Non-browser (curl/Postman) or same-origin can be null -> allow
        if (!origin) return cb(null, true);
        if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS: ' + origin));
    },
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,   // set to true only if you need cookies/credentials
    maxAge: 86400
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle preflight
// ----------------------------------------------------------------------

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// middlewares
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Init DB (non-blocking) ---
(async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync(); // use migrations in production
        console.log('✅ DB connected & synced');
    } catch (err) {
        console.error('❌ DB connection failed:', err.message);
    }
})();

// --- Routes ---
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/auth', authRouter);
app.use('/points', pointsRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404, 'Not Found'));
});

// error handler (JSON for API callers, HTML for pages)
app.use(function(err, req, res, next) {
    const status = err.status || 500;

    // If client expects JSON, return JSON error
    if (req.accepts('json') && !req.accepts('html')) {
        return res.status(status).json({
            ok: false,
            message: err.message,
            ...(req.app.get('env') === 'development' ? { stack: err.stack } : {})
        });
    }

    // Otherwise render error page
    res.locals.message = err.message;
    res.locals.error   = req.app.get('env') === 'development' ? err : {};
    res.status(status);
    res.render('error');
});

module.exports = app;

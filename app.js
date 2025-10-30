// app.js
require('dotenv').config();

var createError   = require('http-errors');
var express       = require('express');
var path          = require('path');
var cookieParser  = require('cookie-parser');
var logger        = require('morgan');

// --- DB (Sequelize) ---
const sequelize = require('./config/db');
require('./models/User');
require('./models/Otp');
require('./models/UserPoint');
require('./models/UserPointLog');

// --- Routers ---
var indexRouter  = require('./routes/index');
var usersRouter  = require('./routes/users');  // contains /users/upsert
var authRouter   = require('./routes/auth');   // contains /auth/send-otp, /auth/verify-otp
var pointsRouter   = require('./routes/points');

var app = express();

// view engine setup (keep your EJS pages)
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
        await sequelize.sync(); // use migrations in prod
        console.log('✅ DB connected & synced');
    } catch (err) {
        console.error('❌ DB connection failed:', err.message);
    }
})();

// --- Routes ---
app.use('/', indexRouter);
app.use('/users', usersRouter); // POST /users/upsert
app.use('/auth', authRouter);   // POST /auth/send-otp, POST /auth/verify-otp
app.use('/points', pointsRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404, 'Not Found'));
});

// error handler (JSON for API callers, HTML for pages)
app.use(function(err, req, res, next) {
    const status = err.status || 500;
    if (req.accepts('json') && !req.accepts('html')) {
        return res.status(status).json({
            ok: false,
            message: err.message,
            ...(req.app.get('env') === 'development' ? { stack: err.stack } : {})
        });
    }
    res.locals.message = err.message;
    res.locals.error   = req.app.get('env') === 'development' ? err : {};
    res.status(status);
    res.render('error');
});

module.exports = app;

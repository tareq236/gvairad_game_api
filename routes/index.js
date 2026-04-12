var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Doctor Access Portal' });
});

router.get('/register', function(req, res, next) {
  res.render('index', { title: 'Doctor Registration', mode: 'register' });
});

router.get('/login', function(req, res, next) {
  res.render('index', { title: 'Doctor Login', mode: 'login' });
});

module.exports = router;

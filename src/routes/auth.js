'use strict';
const express = require('express');
const auth = require('../auth');
const audit = require('../services/audit');
const { h, ip } = require('./helpers');

const router = express.Router();

router.post('/login', h(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await auth.authenticate(email, password);
  if (!user) { res.status(401).json({ error: 'Email atau kata sandi salah.' }); return; }
  req.session.userId = user.id;
  await audit.log(user, 'login', 'user', user.id, null, ip(req));
  res.json({ user });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', h(async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Belum masuk.' });
  const user = await auth.getUser(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Sesi tidak valid.' });
  res.json({ user });
}));

module.exports = router;

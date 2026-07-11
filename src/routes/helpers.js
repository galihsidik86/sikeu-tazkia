'use strict';
// Bungkus handler (boleh async) agar ApiError (punya .status) dipetakan ke JSON.
function h(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) res.status(status).json({ error: e.message || 'Kesalahan server.' });
    }
  };
}
function ip(req) { return req.headers['x-forwarded-for'] || req.socket.remoteAddress; }
module.exports = { h, ip };

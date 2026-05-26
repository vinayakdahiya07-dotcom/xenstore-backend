// api/health.js
// Visit https://your-vercel-app.vercel.app/api/health to verify deployment

module.exports = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'XenStore Backend',
    timestamp: new Date().toISOString(),
  });
};

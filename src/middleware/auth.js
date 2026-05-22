const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-secret';

export function requireAdminKey(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const keyHeader = req.headers['x-admin-key'] || '';

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : keyHeader;

  if (token === ADMIN_KEY) return next();

  res.status(401).json({ error: 'Unauthorized. Provide X-Admin-Key header.' });
}

//For the dashboard web UI, check for key in query param or session cookie

export function requireAdminForUI(req, res, next) {
  const queryKey = req.query.key;
  const cookieKey = parseCookies(req)['admin_key'];
  const token = queryKey || cookieKey;

  if (token === ADMIN_KEY) {
    // Set cookie for subsequent requests
    if (queryKey) {
      res.setHeader('Set-Cookie', `admin_key=${ADMIN_KEY}; HttpOnly; SameSite=Strict; Path=/`);
    }
    return next();
  }

  // Show login form
  res.status(401).send(loginPage(req.path));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}

function loginPage(redirect) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Webhook Service – Login</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); width: 320px; }
    h1 { margin: 0 0 1.5rem; font-size: 1.2rem; }
    input { width: 100%; padding: .5rem; border: 1px solid #ddd; border-radius: 4px;
            font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem; }
    button { width: 100%; padding: .6rem; background: #3b3bca; color: white;
             border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🪝 Webhook Service</h1>
    <form method="GET" action="${redirect}">
      <input type="password" name="key" placeholder="Admin key" autofocus>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * profilo — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────
 * Binding required:  DB  →  D1 database "profilo-db"
 *   (Dashboard → Workers & Pages → profilo → Settings → Bindings → Add → D1 → name it "DB")
 * ─────────────────────────────────────────────────────────────
 */

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // CORS headers — allow the profile frontend to call this worker
    const CORS = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Helper: return JSON
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });

    // ── DB check ─────────────────────────────────────────────
    if (!env.DB) {
      return json({ error: 'D1 binding "DB" not found. Add it in Worker Settings → Bindings.' }, 500);
    }

    // ════════════════════════════════════════════════════════
    //  GET /api/state  — returns all settings as one object
    // ════════════════════════════════════════════════════════
    if (path === '/api/state' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
      const state = {};
      for (const r of results) state[r.key] = r.value;
      // Never expose tokens to public state
      delete state.spotify_token;
      delete state.spotify_refresh;
      delete state.spotify_pkce_verifier;
      return json(state);
    }

    // ════════════════════════════════════════════════════════
    //  POST /api/auth  — verify admin credentials
    //  body: { u_hash, p_hash }
    // ════════════════════════════════════════════════════════
    if (path === '/api/auth' && request.method === 'POST') {
      const { u_hash, p_hash } = await request.json();
      const row = await env.DB.prepare(
        'SELECT u_hash, p_hash FROM credentials WHERE id=1'
      ).first();
      if (!row) return json({ ok: false }, 401);
      const ok = row.u_hash === u_hash && row.p_hash === p_hash;
      return json({ ok }, ok ? 200 : 401);
    }

    // ════════════════════════════════════════════════════════
    //  POST /api/settings  — save one or many settings
    //  body: { u_hash, p_hash, key: value, ... }
    // ════════════════════════════════════════════════════════
    if (path === '/api/settings' && request.method === 'POST') {
      const body = await request.json();
      const { u_hash, p_hash, ...updates } = body;

      // Auth gate
      const row = await env.DB.prepare(
        'SELECT u_hash, p_hash FROM credentials WHERE id=1'
      ).first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      const stmt  = env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const batch = Object.entries(updates).map(([k, v]) => stmt.bind(k, String(v)));
      if (batch.length) await env.DB.batch(batch);

      return json({ ok: true });
    }

    // ════════════════════════════════════════════════════════
    //  POST /api/credentials  — change admin username/password
    //  body: { u_hash, p_hash, new_u_hash, new_p_hash }
    // ════════════════════════════════════════════════════════
    if (path === '/api/credentials' && request.method === 'POST') {
      const { u_hash, p_hash, new_u_hash, new_p_hash } = await request.json();

      const row = await env.DB.prepare(
        'SELECT u_hash, p_hash FROM credentials WHERE id=1'
      ).first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      await env.DB.prepare(
        'UPDATE credentials SET u_hash=?, p_hash=? WHERE id=1'
      ).bind(new_u_hash, new_p_hash).run();

      return json({ ok: true });
    }

    // ════════════════════════════════════════════════════════
    //  GET /spotify/connect?cid=XXX
    //  Admin clicks "Connect Spotify" → browser redirects here
    //  → we kick off PKCE flow → redirect to Spotify
    // ════════════════════════════════════════════════════════
    if (path === '/spotify/connect' && request.method === 'GET') {
      const cid = url.searchParams.get('cid');
      if (!cid) return new Response('Missing cid param', { status: 400 });

      // Save client_id
      await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .bind('spotify_cid', cid).run();

      // Generate PKCE verifier + challenge
      const verifier  = pkceVerifier();
      const challenge = await pkceChallenge(verifier);

      // Store verifier temporarily for the callback
      await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .bind('spotify_pkce_verifier', verifier).run();

      const redirectUri = `${url.origin}/spotify/callback`;

      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.set('client_id',             cid);
      authUrl.searchParams.set('response_type',         'code');
      authUrl.searchParams.set('redirect_uri',          redirectUri);
      authUrl.searchParams.set('scope',                 'user-read-currently-playing user-read-playback-state');
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge',        challenge);
      authUrl.searchParams.set('show_dialog',           'true');

      return Response.redirect(authUrl.toString(), 302);
    }

    // ════════════════════════════════════════════════════════
    //  GET /spotify/callback  — Spotify redirects back here
    // ════════════════════════════════════════════════════════
    if (path === '/spotify/callback' && request.method === 'GET') {
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error || !code) {
        return htmlPage('Spotify Error', `<p style="color:#ff6b8a">Auth error: ${error || 'no code'}</p><a href="/">← Back</a>`);
      }

      const verRow = await env.DB.prepare(
        "SELECT value FROM settings WHERE key='spotify_pkce_verifier'"
      ).first();
      const cidRow = await env.DB.prepare(
        "SELECT value FROM settings WHERE key='spotify_cid'"
      ).first();

      if (!verRow || !cidRow) {
        return htmlPage('Spotify Error', '<p style="color:#ff6b8a">Session expired. Please try connecting again.</p><a href="/">← Back</a>');
      }

      const redirectUri = `${url.origin}/spotify/callback`;

      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  redirectUri,
          client_id:     cidRow.value,
          code_verifier: verRow.value,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return htmlPage('Token Error', `<p style="color:#ff6b8a">Token exchange failed: ${err}</p><a href="/">← Back</a>`);
      }

      const tokens = await tokenRes.json();
      const expiry = Date.now() + tokens.expires_in * 1000;

      await env.DB.batch([
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_token',         tokens.access_token),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_refresh',       tokens.refresh_token || ''),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_expires',       String(expiry)),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_connected',     '1'),
        env.DB.prepare("DELETE FROM settings WHERE key='spotify_pkce_verifier'"),
      ]);

      // Redirect back to profile with success flag
      return Response.redirect(`${url.origin}/#spotify-connected`, 302);
    }

    // ════════════════════════════════════════════════════════
    //  GET /spotify/disconnect  — clear tokens
    // ════════════════════════════════════════════════════════
    if (path === '/spotify/disconnect' && request.method === 'GET') {
      await env.DB.batch([
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_token',     ''),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_refresh',   ''),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_expires',   '0'),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_connected', '0'),
      ]);
      return json({ ok: true });
    }

    // ════════════════════════════════════════════════════════
    //  GET /api/now-playing  — polled every 5s by the frontend
    // ════════════════════════════════════════════════════════
    if (path === '/api/now-playing' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('spotify_token','spotify_refresh','spotify_cid','spotify_expires','spotify_connected')"
      ).all();

      const s = {};
      for (const r of rows.results) s[r.key] = r.value;

      if (!s.spotify_token || s.spotify_connected !== '1') {
        return json({ playing: false });
      }

      let token = s.spotify_token;
      const expires = Number(s.spotify_expires) || 0;

      // Refresh if expired OR within 2 minutes of expiry
      if (Date.now() > expires - 120000) {
        const newToken = await refreshToken(s.spotify_cid, s.spotify_refresh, env);
        if (!newToken) {
          // Mark disconnected so frontend stops trying
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('spotify_connected','0')").run();
          return json({ playing: false, reason: 'token_expired' });
        }
        token = newToken;
      }

      let npRes;
      try {
        npRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        return json({ playing: false, reason: 'fetch_error' });
      }

      if (npRes.status === 204) return json({ playing: false });

      // Token rejected — try one refresh and retry
      if (npRes.status === 401) {
        const newToken = await refreshToken(s.spotify_cid, s.spotify_refresh, env);
        if (!newToken) {
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('spotify_connected','0')").run();
          return json({ playing: false, reason: 'token_expired' });
        }
        npRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          headers: { Authorization: `Bearer ${newToken}` },
        });
        if (!npRes.ok || npRes.status === 204) return json({ playing: false });
      }

      if (!npRes.ok) return json({ playing: false, reason: String(npRes.status) });

      const data = await npRes.json();
      if (!data || !data.is_playing || !data.item) return json({ playing: false });

      return json({
        playing:  true,
        track:    data.item.name,
        artist:   data.item.artists.map(a => a.name).join(', '),
        art:      data.item.album?.images?.[0]?.url || '',
        progress: data.progress_ms  || 0,
        duration: data.item.duration_ms || 1,
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

// ── PKCE ─────────────────────────────────────────────────────
function pkceVerifier(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr   = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

async function pkceChallenge(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Token refresh ─────────────────────────────────────────────
async function refreshToken(clientId, refreshTok, env) {
  if (!refreshTok || !clientId) return null;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshTok,
        client_id:     clientId,
      }),
    });
    if (!res.ok) {
      console.error('[refresh] failed:', res.status, await res.text());
      return null;
    }
    const data   = await res.json();
    const expiry = String(Date.now() + data.expires_in * 1000);
    const batch  = [
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_token',   data.access_token),
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_expires', expiry),
    ];
    if (data.refresh_token) {
      batch.push(
        env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('spotify_refresh', data.refresh_token)
      );
    }
    await env.DB.batch(batch);
    return data.access_token;
  } catch (e) {
    console.error('[refresh] exception:', e);
    return null;
  }
}

// ── Simple HTML response for OAuth redirects ─────────────────
function htmlPage(title, body) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
    <style>body{background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;
    justify-content:center;height:100vh;flex-direction:column;gap:16px}
    a{color:#a8edea}</style></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

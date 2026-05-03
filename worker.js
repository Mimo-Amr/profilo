/**
 * profilo — Cloudflare Worker
 * Last.fm now-playing (free, no OAuth needed)
 * D1 binding: DB → profilo-db
 */

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    const CORS = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });

    if (!env.DB) {
      return json({ error: 'D1 binding "DB" not found.' }, 500);
    }

    // ── GET /api/state ──────────────────────────────────────────
    if (path === '/api/state' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
      const state = {};
      for (const r of results) state[r.key] = r.value;
      return json(state);
    }

    // ── POST /api/auth ──────────────────────────────────────────
    if (path === '/api/auth' && request.method === 'POST') {
      const { u_hash, p_hash } = await request.json();
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row) return json({ ok: false }, 401);
      const ok = row.u_hash === u_hash && row.p_hash === p_hash;
      return json({ ok }, ok ? 200 : 401);
    }

    // ── POST /api/settings ──────────────────────────────────────
    if (path === '/api/settings' && request.method === 'POST') {
      const body = await request.json();
      const { u_hash, p_hash, ...updates } = body;
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const stmt  = env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const batch = Object.entries(updates).map(([k, v]) => stmt.bind(k, String(v)));
      if (batch.length) await env.DB.batch(batch);
      return json({ ok: true });
    }

    // ── POST /api/credentials ───────────────────────────────────
    if (path === '/api/credentials' && request.method === 'POST') {
      const { u_hash, p_hash, new_u_hash, new_p_hash } = await request.json();
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      await env.DB.prepare('UPDATE credentials SET u_hash=?, p_hash=? WHERE id=1')
        .bind(new_u_hash, new_p_hash).run();
      return json({ ok: true });
    }

    // ── GET /api/now-playing  (Last.fm) ─────────────────────────
    if (path === '/api/now-playing' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('lastfm_user','lastfm_api_key')"
      ).all();

      const s = {};
      for (const r of rows.results) s[r.key] = r.value;

      if (!s.lastfm_user || !s.lastfm_api_key) {
        return json({ playing: false, reason: 'not_configured' });
      }

      try {
        const lfRes = await fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
          `&user=${encodeURIComponent(s.lastfm_user)}` +
          `&api_key=${encodeURIComponent(s.lastfm_api_key)}` +
          `&format=json&limit=1`
        );

        if (!lfRes.ok) {
          return json({ playing: false, reason: `lastfm_${lfRes.status}` });
        }

        const data  = await lfRes.json();
        const track = data?.recenttracks?.track?.[0];

        if (!track) return json({ playing: false });

        // Last.fm marks the currently playing track with @attr.nowplaying = "true"
        const isPlaying = track['@attr']?.nowplaying === 'true';
        if (!isPlaying) return json({ playing: false });

        return json({
          playing: true,
          track:   track.name,
          artist:  track.artist['#text'] || track.artist.name || '',
          album:   track.album?.['#text'] || '',
          art:     track.image?.find(i => i.size === 'large')?.['#text'] || '',
        });

      } catch (e) {
        return json({ playing: false, reason: 'fetch_error' });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};

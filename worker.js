/**
 * profilo — Cloudflare Worker
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

    if (!env.DB) {
      return respond({ error: 'D1 binding "DB" missing.' }, 500, CORS);
    }

    // ── GET /api/state ──────────────────────────────────────────
    // No-cache so browser always gets fresh display_name, particle_color etc.
    if (path === '/api/state' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
      const state = {};
      for (const r of results) {
        // Never expose last_track/artist/art via state — only /api/now-playing serves them
        if (['last_track','last_artist','last_art'].includes(r.key)) continue;
        state[r.key] = r.value;
      }
      return respond(state, 200, CORS, true);
    }

    // ── POST /api/auth ──────────────────────────────────────────
    if (path === '/api/auth' && request.method === 'POST') {
      const { u_hash, p_hash } = await request.json();
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row) return respond({ ok: false }, 401, CORS);
      const ok = row.u_hash === u_hash && row.p_hash === p_hash;
      return respond({ ok }, ok ? 200 : 401, CORS);
    }

    // ── POST /api/settings ──────────────────────────────────────
    if (path === '/api/settings' && request.method === 'POST') {
      const body = await request.json();
      const { u_hash, p_hash, ...updates } = body;
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash) {
        return respond({ ok: false, error: 'unauthorized' }, 401, CORS);
      }
      const stmt  = env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const batch = Object.entries(updates).map(([k, v]) => stmt.bind(k, String(v)));
      if (batch.length) await env.DB.batch(batch);
      return respond({ ok: true }, 200, CORS);
    }

    // ── POST /api/credentials ───────────────────────────────────
    if (path === '/api/credentials' && request.method === 'POST') {
      const { u_hash, p_hash, new_u_hash, new_p_hash } = await request.json();
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash) {
        return respond({ ok: false, error: 'unauthorized' }, 401, CORS);
      }
      await env.DB.prepare('UPDATE credentials SET u_hash=?, p_hash=? WHERE id=1')
        .bind(new_u_hash, new_p_hash).run();
      return respond({ ok: true }, 200, CORS);
    }

    // ── POST /api/now-playing ───────────────────────────────────
    // POST is used intentionally — neither Cloudflare edge nor browsers
    // ever cache POST requests, solving the stale-track problem permanently.
    if (path === '/api/now-playing' && request.method === 'POST') {
      const rows = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('lastfm_user','lastfm_api_key','last_track','last_artist','last_art')"
      ).all();

      const s = {};
      for (const r of rows.results) s[r.key] = r.value;

      const notPlaying = (extra = {}) => respond({
        playing: false,
        last_track:  s.last_track  || '',
        last_artist: s.last_artist || '',
        last_art:    s.last_art    || '',
        ...extra,
      }, 200, CORS, true);

      if (!s.lastfm_user || !s.lastfm_api_key) {
        return notPlaying({ reason: 'not_configured' });
      }

      try {
        const lfRes = await fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
          `&user=${encodeURIComponent(s.lastfm_user)}` +
          `&api_key=${encodeURIComponent(s.lastfm_api_key)}` +
          `&format=json&limit=1`,
          {
            // CRITICAL: tell Cloudflare's edge NOT to cache this outgoing fetch.
            // Without this, Cloudflare caches the Last.fm response at the edge
            // and serves stale track data on every worker invocation.
            cf: {
              cacheTtl: 0,
              cacheEverything: false,
            },
            headers: {
              'Cache-Control': 'no-cache, no-store',
              'Pragma': 'no-cache',
            },
          }
        );

        if (!lfRes.ok) return notPlaying({ reason: `lastfm_${lfRes.status}` });

        const data  = await lfRes.json();
        const track = data?.recenttracks?.track?.[0];
        if (!track) return notPlaying();

        const isPlaying = track['@attr']?.nowplaying === 'true';
        const trackName = track.name || '';
        const artist    = track.artist?.['#text'] || track.artist?.name || '';
        const art       = track.image?.find(i => i.size === 'extralarge')?.['#text']
                       || track.image?.find(i => i.size === 'large')?.['#text'] || '';

        if (isPlaying) {
          // Persist currently playing as last_track in D1
          await env.DB.batch([
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_track',  trackName),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_artist', artist),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_art',    art),
          ]);
          return respond({ playing: true, track: trackName, artist, art }, 200, CORS, true);
        }

        // Not currently playing — return the most recent track as last_played
        return respond({
          playing:     false,
          last_track:  trackName || s.last_track,
          last_artist: artist    || s.last_artist,
          last_art:    art       || s.last_art,
        }, 200, CORS, true);

      } catch (e) {
        return notPlaying({ reason: 'fetch_error' });
      }
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

// ── Helper: build a JSON response, optionally with no-cache headers ──
function respond(data, status, cors, noCache = false) {
  const headers = {
    ...cors,
    'Content-Type': 'application/json',
  };
  if (noCache) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
    headers['Pragma']        = 'no-cache';
    headers['Expires']       = '0';
    headers['Surrogate-Control'] = 'no-store'; // Cloudflare edge cache bypass
  }
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * profilo — Cloudflare Worker
 * D1 binding: DB → profilo-db
 *
 * Now-playing state machine:
 *   Last.fm nowplaying=true  → save as current_track → return playing:true
 *   Last.fm nowplaying=false AND current_track exists → move to last_track, clear current → return playing:false
 *   Last.fm nowplaying=false AND current_track empty  → return playing:false with existing last_track
 *
 * This way last_track is ONLY ever set from songs we CONFIRMED were playing
 * via the nowplaying flag — never from Last.fm history.
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
    if (path === '/api/state' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
      const state = {};
      for (const r of results) {
        // Never expose track data via state — only /api/now-playing controls the bar
        if (['last_track','last_artist','last_art','current_track','current_artist','current_art'].includes(r.key)) continue;
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
    // Uses POST so neither Cloudflare edge nor browsers ever cache it.
    // State machine:
    //   playing  → save current_track in D1
    //   stopped  → if current_track exists, move it to last_track then clear it
    //              (last_track is NEVER read from Last.fm history)
    if (path === '/api/now-playing' && request.method === 'POST') {

      // Read all track state from D1 in one query
      const { results } = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('lastfm_user','lastfm_api_key','current_track','current_artist','current_art','last_track','last_artist','last_art')"
      ).all();
      const s = {};
      for (const r of results) s[r.key] = r.value;

      if (!s.lastfm_user || !s.lastfm_api_key) {
        return respond({
          playing: false,
          last_track:  '',
          last_artist: '',
          last_art:    '',
        }, 200, CORS, true);
      }

      let lfData = null;
      try {
        // cf:{cacheTtl:0} prevents Cloudflare from caching this subrequest
        const lfRes = await fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
          `&user=${encodeURIComponent(s.lastfm_user)}` +
          `&api_key=${encodeURIComponent(s.lastfm_api_key)}` +
          `&format=json&limit=1`,
          {
            cf: { cacheTtl: 0, cacheEverything: false },
            headers: { 'Cache-Control': 'no-cache' },
          }
        );
        if (lfRes.ok) lfData = await lfRes.json();
      } catch (e) {
        // Last.fm unreachable — return current D1 state
      }

      const track = lfData?.recenttracks?.track?.[0];
      const isPlaying = track?.['@attr']?.nowplaying === 'true';

      if (isPlaying) {
        const trackName = track.name || '';
        const artist    = track.artist?.['#text'] || track.artist?.name || '';
        const art       = track.image?.find(i => i.size === 'extralarge')?.['#text']
                       || track.image?.find(i => i.size === 'large')?.['#text'] || '';

        // Save as current_track — only update D1 if something changed
        const changed = (trackName !== s.current_track || artist !== s.current_artist);
        if (changed) {
          await env.DB.batch([
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('current_track',  trackName),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('current_artist', artist),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('current_art',    art),
          ]);
        }

        return respond({
          playing: true,
          track:   trackName,
          artist,
          art,
        }, 200, CORS, true);

      } else {
        // Not playing right now
        // If we had a current_track saved → move it to last_track and clear current
        if (s.current_track) {
          await env.DB.batch([
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_track',     s.current_track),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_artist',    s.current_artist),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_art',       s.current_art),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('current_track',  ''),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('current_artist', ''),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('current_art',    ''),
          ]);
          // Return the song that just stopped as last_track
          return respond({
            playing:     false,
            last_track:  s.current_track,
            last_artist: s.current_artist,
            last_art:    s.current_art,
          }, 200, CORS, true);
        }

        // Nothing playing, nothing to move — return existing last_track from D1
        return respond({
          playing:     false,
          last_track:  s.last_track  || '',
          last_artist: s.last_artist || '',
          last_art:    s.last_art    || '',
        }, 200, CORS, true);
      }
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

// Build a JSON response, always with no-cache when noCache=true
function respond(data, status, cors, noCache = false) {
  const headers = { ...cors, 'Content-Type': 'application/json' };
  if (noCache) {
    headers['Cache-Control']      = 'no-store, no-cache, must-revalidate, max-age=0';
    headers['Pragma']             = 'no-cache';
    headers['Expires']            = '0';
    headers['Surrogate-Control']  = 'no-store';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

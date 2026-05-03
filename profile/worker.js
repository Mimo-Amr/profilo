/**
 * profilo — Cloudflare Worker
 * D1: DB binding → profilo-db
 * R2: MEDIA binding → profilo-media  (enable R2 in dashboard first)
 */

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    const CORS = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    if (!env.DB) return json({ error: 'D1 binding "DB" missing.' }, 500);

    // Wrap a Response with no-cache headers
    const noCache = (res) => {
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.headers.set('Pragma', 'no-cache');
      res.headers.set('Expires', '0');
      return res;
    };

    // ── GET /api/state ─────────────────────────────────────────
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
      return json({ ok: row.u_hash === u_hash && row.p_hash === p_hash });
    }

    // ── POST /api/settings ──────────────────────────────────────
    if (path === '/api/settings' && request.method === 'POST') {
      const body = await request.json();
      const { u_hash, p_hash, ...updates } = body;
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash)
        return json({ ok: false, error: 'unauthorized' }, 401);
      const stmt  = env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const batch = Object.entries(updates).map(([k, v]) => stmt.bind(k, String(v)));
      if (batch.length) await env.DB.batch(batch);
      return json({ ok: true });
    }

    // ── POST /api/credentials ───────────────────────────────────
    if (path === '/api/credentials' && request.method === 'POST') {
      const { u_hash, p_hash, new_u_hash, new_p_hash } = await request.json();
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash)
        return json({ ok: false, error: 'unauthorized' }, 401);
      await env.DB.prepare('UPDATE credentials SET u_hash=?, p_hash=? WHERE id=1')
        .bind(new_u_hash, new_p_hash).run();
      return json({ ok: true });
    }

    // ── GET /api/now-playing  (Last.fm) ─────────────────────────
    if (path === '/api/now-playing' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('lastfm_user','lastfm_api_key','last_track','last_artist','last_art')"
      ).all();
      const s = {};
      for (const r of rows.results) s[r.key] = r.value;

      if (!s.lastfm_user || !s.lastfm_api_key) {
        return noCache(json({ playing: false, last_track: s.last_track||'', last_artist: s.last_artist||'', last_art: s.last_art||'' }));
      }

      try {
        const lfRes = await fetch(
          `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
          `&user=${encodeURIComponent(s.lastfm_user)}` +
          `&api_key=${encodeURIComponent(s.lastfm_api_key)}` +
          `&format=json&limit=1`
        );
        if (!lfRes.ok) return noCache(json({ playing: false, reason: `lastfm_${lfRes.status}`, last_track: s.last_track||'', last_artist: s.last_artist||'', last_art: s.last_art||'' }));

        const data  = await lfRes.json();
        const track = data?.recenttracks?.track?.[0];
        if (!track) return noCache(json({ playing: false, last_track: s.last_track||'', last_artist: s.last_artist||'', last_art: s.last_art||'' }));

        const isPlaying = track['@attr']?.nowplaying === 'true';
        const trackName = track.name || '';
        const artist    = track.artist?.['#text'] || track.artist?.name || '';
        const art       = track.image?.find(i => i.size === 'extralarge')?.['#text']
                       || track.image?.find(i => i.size === 'large')?.['#text'] || '';

        if (isPlaying) {
          // Persist last played to D1
          await env.DB.batch([
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_track',  trackName),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_artist', artist),
            env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('last_art',    art),
          ]);
          return noCache(json({ playing: true, track: trackName, artist, art }));
        } else {
          return noCache(json({ playing: false, last_track: trackName || s.last_track, last_artist: artist || s.last_artist, last_art: art || s.last_art }));
        }
      } catch (e) {
        return noCache(json({ playing: false, last_track: s.last_track||'', last_artist: s.last_artist||'', last_art: s.last_art||'' }));
      }
    }

    // ── PUT /api/media/upload  (R2) ──────────────────────────────
    if (path === '/api/media/upload' && request.method === 'PUT') {
      if (!env.MEDIA) return json({ ok: false, error: 'R2 not configured. Enable R2 in Cloudflare dashboard and add MEDIA binding to wrangler.jsonc' }, 503);

      // Auth via query param (u_hash:p_hash)
      const auth = url.searchParams.get('auth') || '';
      const [u_hash, p_hash] = auth.split(':');
      const row = await env.DB.prepare('SELECT u_hash, p_hash FROM credentials WHERE id=1').first();
      if (!row || row.u_hash !== u_hash || row.p_hash !== p_hash)
        return json({ ok: false, error: 'unauthorized' }, 401);

      const type     = url.searchParams.get('type') || 'photo'; // 'photo' or 'video'
      const ext      = type === 'video' ? 'mp4' : 'jpg';
      const filename = `bg-${type}.${ext}`;
      const ct       = request.headers.get('Content-Type') || (type === 'video' ? 'video/mp4' : 'image/jpeg');

      await env.MEDIA.put(filename, request.body, { httpMetadata: { contentType: ct } });

      const publicUrl = `${url.origin}/media/${filename}`;

      // Save to D1
      await env.DB.batch([
        env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('bg_media_type', type),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('bg_media_url',  publicUrl),
        env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('bg_mode',       type),
      ]);

      return json({ ok: true, url: publicUrl });
    }

    // ── GET /media/:filename  (R2 serve) ─────────────────────────
    if (path.startsWith('/media/') && request.method === 'GET') {
      if (!env.MEDIA) return new Response('R2 not configured', { status: 503 });
      const filename = path.replace('/media/', '');
      const obj = await env.MEDIA.get(filename);
      if (!obj) return new Response('Not found', { status: 404 });
      const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
      return new Response(obj.body, {
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=31536000',
          ...CORS,
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

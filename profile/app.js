'use strict';

const GITHUB_USER = 'mimo-amr';

const LANG_COLORS = {
  JavaScript:'#f1e05a',TypeScript:'#3178c6',Python:'#3572A5',
  HTML:'#e34c26',CSS:'#563d7c',Java:'#b07219',Ruby:'#701516',
  Go:'#00ADD8',Rust:'#dea584',C:'#555555','C++':'#f34b7d',
  'C#':'#178600',PHP:'#4F5D95',Swift:'#F05138',Kotlin:'#A97BFF',
  Dart:'#00B4AB',Shell:'#89e051',Vue:'#41b883',Svelte:'#ff3e00',
};

/* ── SHA-256 ── */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ── Session ── */
let sessionHashes = null;

/* ── Toast ── */
let _tt;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ── API — pure relative URLs, no prefix ── */
async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function saveSetting(updates) {
  if (!sessionHashes) return;
  try { return await apiPost('/api/settings', { ...sessionHashes, ...updates }); }
  catch (e) { console.warn('[save]', e); }
}

/* ════════════════════════════════════════
   LOADER — dismisses when D1 state loaded
════════════════════════════════════════ */
function showPage() {
  const loader = document.getElementById('loader');
  loader.classList.add('fade-out');
  setTimeout(() => loader.style.display = 'none', 750);
  document.getElementById('page').classList.add('page-visible');
  document.getElementById('admin-trigger').classList.add('page-visible');
}

/* ── Remote state polling ── */
let _lastName = '', _lastColor = '';
async function pollState() {
  try {
    const s = await apiGet('/api/state');
    if (s.display_name && s.display_name !== _lastName) {
      _lastName = s.display_name;
      document.getElementById('display-name').textContent = s.display_name;
    }
    if (s.particle_color && s.particle_color !== _lastColor) {
      _lastColor = s.particle_color;
      particleColor = s.particle_color;
    }
  } catch (e) {}
}

/* ── GitHub ── */
async function loadGitHub() {
  try {
    const [pr, rr] = await Promise.all([
      fetch(`https://api.github.com/users/${GITHUB_USER}`).then(r => r.json()),
      fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated`).then(r => r.json()),
    ]);
    if (pr.avatar_url) document.getElementById('avatar').src = pr.avatar_url;
    setStat('stat-repos',     pr.public_repos, 'repos');
    setStat('stat-followers', pr.followers,    'followers');
    setStat('stat-following', pr.following,    'following');
    renderRepos(rr);
    renderLicense(rr);
  } catch (e) { console.warn('[github]', e); }
}
function setStat(id, val, label) {
  document.getElementById(id).innerHTML = `<b>${val ?? '—'}</b><span>${label}</span>`;
}
function renderRepos(repos) {
  const grid = document.getElementById('repos-grid');
  grid.innerHTML = '';
  [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)).forEach(r => {
    const col = LANG_COLORS[r.language] || '#888';
    const card = document.createElement('a');
    card.href = r.html_url; card.target = '_blank'; card.rel = 'noopener noreferrer';
    card.className = 'repo-card glass';
    card.innerHTML = `
      <div class="repo-name">${esc(r.name)}</div>
      <div class="repo-desc">${r.description ? esc(r.description) : '<em style="opacity:.38">No description</em>'}</div>
      <div class="repo-meta">
        ${r.language ? `<span><span class="lang-dot" style="background:${col}"></span>${r.language}</span>` : ''}
        <span>★ ${r.stargazers_count || 0}</span>
        <span>⑂ ${r.forks_count || 0}</span>
      </div>`;
    grid.appendChild(card);
  });
}
function renderLicense(repos) {
  const lr = repos.find(r => r.license);
  document.getElementById('license-name').textContent = lr ? lr.license.name : 'No License Detected';
  document.getElementById('license-body').textContent = lr
    ? `Applied in "${lr.name}". SPDX: ${lr.license.spdx_id || 'N/A'}.`
    : 'None of the public repositories carry a recognized license file.';
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ════════════════════════════════════════
   SPOTIFY — poll /api/now-playing every 5s
   Completely standalone, no WORKER_URL needed
════════════════════════════════════════ */
async function pollNowPlaying() {
  try {
    const res = await fetch('/api/now-playing');
    if (!res.ok) { hideSpotifyBar(); return; }
    const d = await res.json();
    if (d && d.playing === true) {
      showSpotifyBar(d.track, d.artist, d.art, d.progress / d.duration);
    } else {
      hideSpotifyBar();
    }
  } catch (e) {
    hideSpotifyBar();
  }
}

function showSpotifyBar(track, artist, artUrl, ratio) {
  document.getElementById('sp-track').textContent  = track  || '—';
  document.getElementById('sp-artist').textContent = artist || '—';
  const art = document.getElementById('sp-art');
  if (artUrl) { art.src = artUrl; art.style.display = 'block'; }
  else { art.style.display = 'none'; }
  document.getElementById('sp-progress-fill').style.width =
    `${Math.min(100, Math.round((ratio || 0) * 100))}%`;
  document.getElementById('spotify-bar').classList.remove('sp-hidden');
}

function hideSpotifyBar() {
  document.getElementById('spotify-bar').classList.add('sp-hidden');
}

function updateSpotifyAdminUI(connected) {
  const cv = document.getElementById('sp-connected-view');
  const dv = document.getElementById('sp-disconnected-view');
  if (!cv || !dv) return;
  cv.style.display = connected ? 'block' : 'none';
  dv.style.display = connected ? 'none'  : 'block';
}

/* ════════════════════════════════════════
   PARTICLES
════════════════════════════════════════ */
const canvas = document.getElementById('bg-canvas');
const ctx    = canvas.getContext('2d');
let particles = [], animFrame = null, particleColor = '#a8edea', currentBgMode = 'particles';

function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function resizeCanvas() { canvas.width = innerWidth; canvas.height = innerHeight; }
function initParticles() {
  resizeCanvas();
  const n = Math.min(180, Math.floor((canvas.width * canvas.height) / 10000));
  particles = Array.from({ length: n }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * canvas.height,
    vx: (Math.random() - .5) * .65,  vy: (Math.random() - .5) * .65,
    r: Math.random() * 1.8 + .8,
  }));
}
function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const MAX = 135;
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = canvas.width;  if (p.x > canvas.width)  p.x = 0;
    if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = hexRgba(particleColor, .9); ctx.fill();
  }
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < MAX) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = hexRgba(particleColor, (1 - dist / MAX) * .45);
        ctx.lineWidth = .7; ctx.stroke();
      }
    }
  }
  animFrame = requestAnimationFrame(drawFrame);
}
function startParticles() {
  if (animFrame) cancelAnimationFrame(animFrame);
  canvas.style.display = 'block'; initParticles(); drawFrame();
}
function stopParticles() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = 'none';
}
window.addEventListener('resize', () => {
  if (currentBgMode === 'particles') { resizeCanvas(); initParticles(); }
});

/* ════════════════════════════════════════
   BACKGROUND MODES
════════════════════════════════════════ */
function setBgMode(mode, save = true) {
  currentBgMode = mode; stopParticles();
  const vid = document.getElementById('bg-video');
  const photo = document.getElementById('bg-photo-layer');
  vid.pause(); vid.removeAttribute('src'); vid.load();
  vid.style.display = 'none'; photo.style.display = 'none';
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  renderBgSub(mode);
  if (mode === 'particles') startParticles();
  if (save) saveSetting({ bg_mode: mode });
}
function renderBgSub(mode) {
  const sub = document.getElementById('bg-sub');
  sub.innerHTML = '';
  if (mode === 'particles') {
    sub.innerHTML = `<div class="color-row">
      <label>Particle colour</label>
      <input type="color" id="pcolor" value="${particleColor}"/>
      <span style="font-size:.78rem;color:var(--muted)" id="pcolor-hex">${particleColor}</span>
    </div>`;
    document.getElementById('pcolor').addEventListener('input', e => {
      particleColor = e.target.value;
      document.getElementById('pcolor-hex').textContent = e.target.value;
      saveSetting({ particle_color: e.target.value });
    });
  }
  if (mode === 'video') {
    sub.innerHTML = `<button class="upload-btn" id="video-upload-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>Click to choose a video file…</button>`;
    document.getElementById('video-upload-btn').addEventListener('click', () =>
      document.getElementById('picker-video').click());
  }
  if (mode === 'photo') {
    sub.innerHTML = `<button class="upload-btn" id="photo-upload-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>Click to choose a photo file…</button>`;
    document.getElementById('photo-upload-btn').addEventListener('click', () =>
      document.getElementById('picker-photo').click());
  }
}
document.getElementById('picker-video').addEventListener('change', function () {
  const f = this.files[0]; if (!f) return;
  const vid = document.getElementById('bg-video');
  vid.src = URL.createObjectURL(f); vid.style.display = 'block'; vid.load(); vid.play();
  toast('✓ Video applied');
});
document.getElementById('picker-photo').addEventListener('change', function () {
  const f = this.files[0]; if (!f) return;
  const l = document.getElementById('bg-photo-layer');
  l.style.backgroundImage = `url(${URL.createObjectURL(f)})`; l.style.display = 'block';
  toast('✓ Photo applied');
});

/* ════════════════════════════════════════
   ADMIN MODAL
════════════════════════════════════════ */
document.getElementById('admin-trigger').addEventListener('click', () => {
  document.getElementById('admin-modal').classList.add('open');
  document.getElementById('adm-user').value = '';
  document.getElementById('adm-pass').value = '';
  document.getElementById('login-error').style.display = 'none';
});
document.getElementById('admin-close').addEventListener('click', closeAdmin);
document.getElementById('admin-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('admin-modal')) closeAdmin();
});
function closeAdmin() {
  document.getElementById('admin-modal').classList.remove('open');
  showLoginView();
}
function showLoginView() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('settings-view').style.display = 'none';
}
async function showSettingsView() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('settings-view').style.display = 'flex';
  document.getElementById('edit-name').value = document.getElementById('display-name').textContent;
  const el = document.getElementById('sp-redirect-display');
  if (el) el.textContent = `${location.origin}/spotify/callback`;
  renderBgSub(currentBgMode);
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === currentBgMode));
  try {
    const s = await apiGet('/api/state');
    updateSpotifyAdminUI(s.spotify_connected === '1');
    if (s.particle_color) { particleColor = s.particle_color; _lastColor = s.particle_color; }
  } catch (e) {}
}

/* ── Login ── */
document.getElementById('login-btn').addEventListener('click', attemptLogin);
['adm-user','adm-pass'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); })
);
async function attemptLogin() {
  const user  = document.getElementById('adm-user').value.trim();
  const pass  = document.getElementById('adm-pass').value;
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  if (!user || !pass) return;
  btn.textContent = 'Verifying…'; btn.disabled = true; errEl.style.display = 'none';
  try {
    const u_hash = await sha256(user);
    const p_hash = await sha256(pass);
    const result = await apiPost('/api/auth', { u_hash, p_hash });
    if (result && result.ok) {
      sessionHashes = { u_hash, p_hash };
      showSettingsView();
    } else {
      errEl.textContent = '✕ Wrong username or password';
      errEl.style.display = 'block';
      document.getElementById('adm-pass').value = '';
      sessionHashes = null;
    }
  } catch (e) {
    errEl.textContent = '✕ Cannot reach server';
    errEl.style.display = 'block';
    console.error('[login]', e);
  } finally {
    btn.textContent = 'UNLOCK →'; btn.disabled = false;
  }
}

/* ── Logout ── */
document.getElementById('logout-btn').addEventListener('click', () => {
  sessionHashes = null; showLoginView(); toast('Logged out');
});

/* ── BG tabs ── */
document.getElementById('bg-options').addEventListener('click', e => {
  const b = e.target.closest('.bg-opt'); if (b) setBgMode(b.dataset.mode);
});

/* ── Display name ── */
document.getElementById('update-name-btn').addEventListener('click', async () => {
  const v = document.getElementById('edit-name').value.trim(); if (!v) return;
  document.getElementById('display-name').textContent = v; _lastName = v;
  const r = await saveSetting({ display_name: v });
  toast(r && r.ok ? '✓ Name saved — live for everyone' : '✕ Save failed');
});

/* ── Spotify connect ── */
document.getElementById('sp-connect-btn').addEventListener('click', () => {
  const cid = document.getElementById('sp-client-id').value.trim();
  if (!cid) { toast('⚠ Paste your Client ID first'); return; }
  window.location.href = `/spotify/connect?cid=${encodeURIComponent(cid)}`;
});

/* ── Spotify disconnect ── */
document.getElementById('sp-disconnect-btn').addEventListener('click', async () => {
  try { await fetch('/spotify/disconnect'); } catch (e) {}
  updateSpotifyAdminUI(false); hideSpotifyBar(); toast('Spotify disconnected');
});

/* ── Change credentials ── */
document.getElementById('save-creds-btn').addEventListener('click', async () => {
  const u = document.getElementById('new-user').value.trim();
  const p = document.getElementById('new-pass').value;
  if (!u || !p) { toast('⚠ Fill both fields'); return; }
  try {
    const new_u_hash = await sha256(u), new_p_hash = await sha256(p);
    const r = await apiPost('/api/credentials', { ...sessionHashes, new_u_hash, new_p_hash });
    if (r && r.ok) {
      sessionHashes = { u_hash: new_u_hash, p_hash: new_p_hash };
      document.getElementById('new-user').value = '';
      document.getElementById('new-pass').value = '';
      toast('✓ Credentials updated');
    } else toast('✕ Failed');
  } catch (e) { toast('✕ Error'); }
});

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
(async function init() {
  // Spotify return check
  if (location.hash === '#spotify-connected') {
    history.replaceState(null, '', location.pathname);
    toast('✓ Spotify connected! Bar shows when music plays.');
  }

  // Start particles immediately (behind loader)
  setBgMode('particles', false);

  // Load GitHub + D1 state in parallel
  const [_, state] = await Promise.allSettled([
    loadGitHub(),
    apiGet('/api/state').catch(() => null),
  ]);

  // Apply D1 state
  const s = state.value;
  if (s) {
    if (s.display_name) {
      document.getElementById('display-name').textContent = s.display_name;
      _lastName = s.display_name;
    }
    if (s.particle_color) { particleColor = s.particle_color; _lastColor = s.particle_color; }
  }

  // Dismiss loader — data is ready
  showPage();

  // Start polling
  setInterval(pollState, 3000);
  pollNowPlaying();
  setInterval(pollNowPlaying, 5000);
})();

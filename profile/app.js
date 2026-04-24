'use strict';

/* ═══════════════════════════════════════════════════════════
   CONFIG — change WORKER_URL to your deployed worker URL
═══════════════════════════════════════════════════════════ */
const WORKER_URL = ''; // same domain — use relative paths
const GITHUB_USER = 'mimo-amr';

/* ═══════════════════════════════════════════════════════════
   LANG COLORS
═══════════════════════════════════════════════════════════ */
const LANG_COLORS = {
  JavaScript:'#f1e05a', TypeScript:'#3178c6', Python:'#3572A5',
  HTML:'#e34c26', CSS:'#563d7c', Java:'#b07219', Ruby:'#701516',
  Go:'#00ADD8', Rust:'#dea584', C:'#555555', 'C++':'#f34b7d',
  'C#':'#178600', PHP:'#4F5D95', Swift:'#F05138', Kotlin:'#A97BFF',
  Dart:'#00B4AB', Shell:'#89e051', Vue:'#41b883', Svelte:'#ff3e00',
};

/* ═══════════════════════════════════════════════════════════
   SESSION — admin credentials live in memory only
═══════════════════════════════════════════════════════════ */
let sessionHashes = null; // { u_hash, p_hash } once logged in

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ═══════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════ */
let _toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ═══════════════════════════════════════════════════════════
   WORKER API HELPERS
═══════════════════════════════════════════════════════════ */
async function apiGet(path) {
  const res = await fetch(WORKER_URL + path);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(WORKER_URL + path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

/* Save setting(s) to D1 — always authenticated */
async function saveSetting(updates) {
  if (!sessionHashes) return;
  return apiPost('/api/settings', { ...sessionHashes, ...updates });
}

/* ═══════════════════════════════════════════════════════════
   STATE POLLING — apply remote state to DOM every 3s
═══════════════════════════════════════════════════════════ */
let lastDisplayName = '';
let lastBgMode      = '';
let lastParticleCol = '';

async function pollState() {
  try {
    const state = await apiGet('/api/state');
    applyState(state);
  } catch (e) {
    console.warn('[state poll]', e);
  }
}

function applyState(state) {
  // Display name
  if (state.display_name && state.display_name !== lastDisplayName) {
    lastDisplayName = state.display_name;
    document.getElementById('display-name').textContent = state.display_name;
  }

  // Background mode
  if (state.bg_mode && state.bg_mode !== lastBgMode) {
    lastBgMode = state.bg_mode;
    if (state.bg_mode === 'particles') startParticles();
    // video/photo are local-only (can't store binary in D1)
  }

  // Particle color
  if (state.particle_color && state.particle_color !== lastParticleCol) {
    lastParticleCol = state.particle_color;
    particleColor   = state.particle_color;
  }

  // Spotify connection status (for admin panel)
  if (state.spotify_connected === '1') {
    updateSpotifyAdminUI(true);
  }
}

/* ═══════════════════════════════════════════════════════════
   GITHUB
═══════════════════════════════════════════════════════════ */
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
  } catch (e) {
    console.warn('[GitHub]', e);
  }
}

function setStat(id, val, label) {
  document.getElementById(id).innerHTML = `<b>${val ?? '—'}</b><span>${label}</span>`;
}

function renderRepos(repos) {
  const grid = document.getElementById('repos-grid');
  grid.innerHTML = '';
  [...repos]
    .sort((a,b) => (b.stargazers_count||0) - (a.stargazers_count||0))
    .forEach(r => {
      const col  = LANG_COLORS[r.language] || '#888';
      const card = document.createElement('a');
      card.href      = r.html_url;
      card.target    = '_blank';
      card.rel       = 'noopener noreferrer';
      card.className = 'repo-card glass';
      card.innerHTML = `
        <div class="repo-name">${esc(r.name)}</div>
        <div class="repo-desc">${r.description ? esc(r.description) : '<em style="opacity:.38">No description</em>'}</div>
        <div class="repo-meta">
          ${r.language ? `<span><span class="lang-dot" style="background:${col}"></span>${r.language}</span>` : ''}
          <span>★ ${r.stargazers_count||0}</span>
          <span>⑂ ${r.forks_count||0}</span>
        </div>`;
      grid.appendChild(card);
    });
}

function renderLicense(repos) {
  const lr = repos.find(r => r.license);
  document.getElementById('license-name').textContent =
    lr ? lr.license.name : 'No License Detected';
  document.getElementById('license-body').textContent =
    lr ? `Applied in "${lr.name}". SPDX: ${lr.license.spdx_id || 'N/A'}.`
       : 'None of the public repositories carry a recognized license file.';
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ═══════════════════════════════════════════════════════════
   SPOTIFY — frontend polls /api/now-playing every 5s
═══════════════════════════════════════════════════════════ */
async function pollNowPlaying() {
  try {
    const data = await apiGet('/api/now-playing');
    if (data.playing) {
      showSpotifyBar(data.track, data.artist, data.art, data.progress / data.duration);
    } else {
      hideSpotifyBar();
    }
  } catch (e) {
    hideSpotifyBar();
  }
}

function showSpotifyBar(track, artist, artUrl, ratio) {
  document.getElementById('sp-track').textContent  = track;
  document.getElementById('sp-artist').textContent = artist;
  const artEl = document.getElementById('sp-art');
  artEl.src = artUrl;
  artEl.style.display = artUrl ? 'block' : 'none';
  document.getElementById('sp-progress-fill').style.width = `${Math.round(ratio * 100)}%`;
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

/* ═══════════════════════════════════════════════════════════
   PARTICLES
═══════════════════════════════════════════════════════════ */
const canvas = document.getElementById('bg-canvas');
const ctx    = canvas.getContext('2d');
let particles  = [];
let animFrame  = null;
let particleColor = '#a8edea';

function hexRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initParticles() {
  resizeCanvas();
  const n = Math.min(180, Math.floor((canvas.width * canvas.height) / 10000));
  particles = Array.from({ length: n }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random()-.5) * .65,
    vy: (Math.random()-.5) * .65,
    r: Math.random() * 1.8 + .8,
  }));
}

function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const MAX = 135;
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0)             p.x = canvas.width;
    if (p.x > canvas.width)  p.x = 0;
    if (p.y < 0)             p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = hexRgba(particleColor, .9);
    ctx.fill();
  }
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx   = particles[i].x - particles[j].x;
      const dy   = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < MAX) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = hexRgba(particleColor, (1 - dist / MAX) * .45);
        ctx.lineWidth = .7;
        ctx.stroke();
      }
    }
  }
  animFrame = requestAnimationFrame(drawFrame);
}

function startParticles() {
  if (animFrame) cancelAnimationFrame(animFrame);
  canvas.style.display = 'block';
  initParticles();
  drawFrame();
}

function stopParticles() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = 'none';
}

window.addEventListener('resize', () => {
  if (currentBgMode === 'particles') { resizeCanvas(); initParticles(); }
});

/* ═══════════════════════════════════════════════════════════
   BACKGROUND MODES
═══════════════════════════════════════════════════════════ */
let currentBgMode = 'particles';

function setBgMode(mode, save = true) {
  currentBgMode = mode;
  stopParticles();
  const vid   = document.getElementById('bg-video');
  const photo = document.getElementById('bg-photo-layer');
  vid.pause(); vid.removeAttribute('src'); vid.load();
  vid.style.display   = 'none';
  photo.style.display = 'none';

  document.querySelectorAll('.bg-opt').forEach(
    b => b.classList.toggle('active', b.dataset.mode === mode)
  );
  renderBgSub(mode);
  if (mode === 'particles') startParticles();
  if (save) saveSetting({ bg_mode: mode });
}

function renderBgSub(mode) {
  const sub = document.getElementById('bg-sub');
  sub.innerHTML = '';

  if (mode === 'particles') {
    sub.innerHTML = `
      <div class="color-row">
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
    sub.innerHTML = `
      <button class="upload-btn" id="video-upload-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Click to choose a video file…
      </button>`;
    document.getElementById('video-upload-btn').addEventListener('click', () =>
      document.getElementById('picker-video').click()
    );
  }

  if (mode === 'photo') {
    sub.innerHTML = `
      <button class="upload-btn" id="photo-upload-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Click to choose a photo file…
      </button>`;
    document.getElementById('photo-upload-btn').addEventListener('click', () =>
      document.getElementById('picker-photo').click()
    );
  }
}

document.getElementById('picker-video').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const vid = document.getElementById('bg-video');
  vid.src = URL.createObjectURL(file);
  vid.style.display = 'block';
  vid.load(); vid.play();
  toast('✓ Video applied');
});

document.getElementById('picker-photo').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const layer = document.getElementById('bg-photo-layer');
  layer.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
  layer.style.display = 'block';
  toast('✓ Photo applied');
});

/* ═══════════════════════════════════════════════════════════
   ADMIN MODAL
═══════════════════════════════════════════════════════════ */
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
  document.getElementById('login-view').style.display    = 'flex';
  document.getElementById('settings-view').style.display = 'none';
}

function showSettingsView() {
  document.getElementById('login-view').style.display    = 'none';
  document.getElementById('settings-view').style.display = 'flex';
  document.getElementById('edit-name').value = document.getElementById('display-name').textContent;
  // Show correct redirect URI for Spotify
  const spRedirectEl = document.getElementById('sp-redirect-display');
  if (spRedirectEl) spRedirectEl.textContent = `${WORKER_URL}/spotify/callback`;
  renderBgSub(currentBgMode);
  document.querySelectorAll('.bg-opt').forEach(
    b => b.classList.toggle('active', b.dataset.mode === currentBgMode)
  );
}

/* Login */
document.getElementById('login-btn').addEventListener('click', attemptLogin);
['adm-user','adm-pass'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
  })
);

async function attemptLogin() {
  const user = document.getElementById('adm-user').value.trim();
  const pass = document.getElementById('adm-pass').value;
  if (!user || !pass) return;

  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  btn.textContent = 'Verifying…';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const u_hash = await sha256(user);
    const p_hash = await sha256(pass);
    const result = await apiPost('/api/auth', { u_hash, p_hash });

    if (result.ok) {
      sessionHashes = { u_hash, p_hash };
      showSettingsView();
      const state = await apiGet('/api/state');
      updateSpotifyAdminUI(state.spotify_connected === '1');
    } else {
      errEl.textContent = '✕ Invalid credentials';
      errEl.style.display = 'block';
      document.getElementById('adm-pass').value = '';
      sessionHashes = null;
    }
  } catch (e) {
    errEl.textContent = '✕ Connection error — try again';
    errEl.style.display = 'block';
    console.error('[login]', e);
  } finally {
    btn.textContent = 'UNLOCK →';
    btn.disabled = false;
  }
}

/* Logout */
document.getElementById('logout-btn').addEventListener('click', () => {
  sessionHashes = null;
  showLoginView();
  toast('Logged out');
});

/* Background buttons */
document.getElementById('bg-options').addEventListener('click', e => {
  const btn = e.target.closest('.bg-opt');
  if (btn) setBgMode(btn.dataset.mode);
});

/* Display name */
document.getElementById('update-name-btn').addEventListener('click', async () => {
  const v = document.getElementById('edit-name').value.trim();
  if (!v) return;
  document.getElementById('display-name').textContent = v;
  const res = await saveSetting({ display_name: v });
  toast(res?.ok ? '✓ Name saved to D1 — live for everyone' : '✕ Save failed');
});

/* Spotify connect — opens worker OAuth URL directly */
document.getElementById('sp-connect-btn').addEventListener('click', () => {
  const cid = document.getElementById('sp-client-id').value.trim();
  if (!cid) { toast('⚠ Paste your Spotify Client ID first'); return; }
  // Navigate to the worker which handles the full PKCE flow
  window.location.href = `${WORKER_URL}/spotify/connect?cid=${encodeURIComponent(cid)}`;
});

/* Spotify disconnect */
document.getElementById('sp-disconnect-btn').addEventListener('click', async () => {
  await apiGet('/spotify/disconnect');
  updateSpotifyAdminUI(false);
  hideSpotifyBar();
  toast('Spotify disconnected');
});

/* Change credentials */
document.getElementById('save-creds-btn').addEventListener('click', async () => {
  const u = document.getElementById('new-user').value.trim();
  const p = document.getElementById('new-pass').value;
  if (!u || !p) { toast('⚠ Fill both fields'); return; }
  const new_u_hash = await sha256(u);
  const new_p_hash = await sha256(p);
  const res = await apiPost('/api/credentials', { ...sessionHashes, new_u_hash, new_p_hash });
  if (res.ok) {
    sessionHashes = { u_hash: new_u_hash, p_hash: new_p_hash };
    document.getElementById('new-user').value = '';
    document.getElementById('new-pass').value = '';
    toast('✓ Credentials updated in D1');
  } else {
    toast('✕ Failed — please re-login');
  }
});

/* ═══════════════════════════════════════════════════════════
   CHECK FOR SPOTIFY CALLBACK
═══════════════════════════════════════════════════════════ */
function checkSpotifyReturn() {
  if (window.location.hash === '#spotify-connected') {
    history.replaceState(null, '', window.location.pathname);
    toast('✓ Spotify connected! Music will appear when playing.');
  }
}

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
(async function init() {
  checkSpotifyReturn();
  setBgMode('particles', false);
  loadGitHub();

  // Load initial state from D1
  try {
    const state = await apiGet('/api/state');
    applyState(state);
    // Load saved particle color
    if (state.particle_color) particleColor = state.particle_color;
  } catch (e) {
    console.warn('[init state]', e);
  }

  // Poll remote state every 3s (so all viewers see changes live)
  setInterval(pollState, 3000);

  // Poll Spotify now-playing every 5s
  pollNowPlaying();
  setInterval(pollNowPlaying, 5000);
})();

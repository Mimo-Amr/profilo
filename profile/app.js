'use strict';

/* ══════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════ */
const GITHUB_USER   = 'mimo-amr';
const DEFAULT_USER  = 'Mimo_Amr';
const DEFAULT_PASS  = 'Mimo';

/* Spotify scopes needed */
const SP_SCOPES = 'user-read-currently-playing user-read-playback-state';

/* Language colours */
const LANG_COLORS = {
  JavaScript:'#f1e05a', TypeScript:'#3178c6', Python:'#3572A5',
  HTML:'#e34c26', CSS:'#563d7c', Java:'#b07219', Ruby:'#701516',
  Go:'#00ADD8', Rust:'#dea584', C:'#555555', 'C++':'#f34b7d',
  'C#':'#178600', PHP:'#4F5D95', Swift:'#F05138', Kotlin:'#A97BFF',
  Dart:'#00B4AB', Shell:'#89e051', Vue:'#41b883', Svelte:'#ff3e00',
  Lua:'#000080', SCSS:'#c6538c', Elixir:'#6e4a7e',
};

/* ══════════════════════════════════════════════════════════
   IN-MEMORY STATE  (no localStorage for settings)
══════════════════════════════════════════════════════════ */
const State = {
  bgMode:        'particles',
  particleColor: '#a8edea',
  spotifyToken:  null,
  spClientId:    null,
  spRedirect:    null,
  spPollTimer:   null,
};

/* Credentials live only in sessionStorage so they survive
   the Spotify OAuth redirect but vanish when the tab closes. */
async function ensureCredentials() {
  if (!sessionStorage.getItem('adm_u')) {
    sessionStorage.setItem('adm_u', await sha256(DEFAULT_USER));
    sessionStorage.setItem('adm_p', await sha256(DEFAULT_PASS));
  }
}

async function verifyCredentials(user, pass) {
  const uh = await sha256(user);
  const ph = await sha256(pass);
  return uh === sessionStorage.getItem('adm_u') &&
         ph === sessionStorage.getItem('adm_p');
}

async function changeCredentials(user, pass) {
  sessionStorage.setItem('adm_u', await sha256(user));
  sessionStorage.setItem('adm_p', await sha256(pass));
}

/* ══════════════════════════════════════════════════════════
   SHA-256  (native SubtleCrypto — no external libs)
══════════════════════════════════════════════════════════ */
async function sha256(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(str)
  );
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
let _toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ══════════════════════════════════════════════════════════
   GITHUB
══════════════════════════════════════════════════════════ */
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
    document.getElementById('repos-grid').innerHTML =
      '<p style="color:var(--muted);font-size:.85rem;padding:10px">Could not reach GitHub API.</p>';
    document.getElementById('license-name').textContent = 'Unavailable';
    document.getElementById('license-body').textContent = 'Could not fetch license info.';
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
      const color = LANG_COLORS[r.language] || '#888';
      const card  = document.createElement('a');
      card.href      = r.html_url;
      card.target    = '_blank';
      card.rel       = 'noopener noreferrer';
      card.className = 'repo-card glass';
      card.innerHTML = `
        <div class="repo-name">${esc(r.name)}</div>
        <div class="repo-desc">${r.description ? esc(r.description) : '<em style="opacity:.38">No description</em>'}</div>
        <div class="repo-meta">
          ${r.language ? `<span><span class="lang-dot" style="background:${color}"></span>${r.language}</span>` : ''}
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
    lr
      ? `Applied in "${lr.name}".  SPDX: ${lr.license.spdx_id || 'N/A'}.`
      : 'None of the public repositories carry a recognized license file.';
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ══════════════════════════════════════════════════════════
   SPOTIFY  — Implicit Grant OAuth + live polling
══════════════════════════════════════════════════════════ */

/* Called once on page load — check if we're returning from OAuth */
function handleSpotifyCallback() {
  const hash   = window.location.hash;
  if (!hash.includes('access_token')) return;

  const params = new URLSearchParams(hash.slice(1));
  const token  = params.get('access_token');
  if (!token) return;

  /* Clean the URL so it doesn't show the token */
  history.replaceState(null, '', window.location.pathname);

  /* Restore client id + redirect from sessionStorage */
  State.spClientId   = sessionStorage.getItem('sp_cid')  || '';
  State.spRedirect   = sessionStorage.getItem('sp_ruri') || '';
  State.spotifyToken = token;

  startSpotifyPolling();
  toast('✓ Spotify connected');
}

function connectSpotify() {
  const cid      = document.getElementById('sp-client-id').value.trim();
  const redirect = document.getElementById('sp-redirect').value.trim();

  if (!cid)      { toast('⚠ Enter your Client ID'); return; }
  if (!redirect) { toast('⚠ Enter the Redirect URI'); return; }

  /* Persist so we can recover them after the OAuth redirect */
  sessionStorage.setItem('sp_cid',  cid);
  sessionStorage.setItem('sp_ruri', redirect);

  State.spClientId = cid;
  State.spRedirect = redirect;

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id',     cid);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('redirect_uri',  redirect);
  url.searchParams.set('scope',         SP_SCOPES);
  url.searchParams.set('show_dialog',   'false');

  window.location.href = url.toString();
}

function disconnectSpotify() {
  clearInterval(State.spPollTimer);
  State.spPollTimer  = null;
  State.spotifyToken = null;
  sessionStorage.removeItem('sp_cid');
  sessionStorage.removeItem('sp_ruri');
  hideSpotifyBar();
  updateSpotifyStatusUI(false);
  toast('Spotify disconnected');
}

function startSpotifyPolling() {
  updateSpotifyStatusUI(true);
  pollCurrentlyPlaying();                       /* immediate first poll */
  State.spPollTimer = setInterval(pollCurrentlyPlaying, 5000);
}

async function pollCurrentlyPlaying() {
  if (!State.spotifyToken) return;
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${State.spotifyToken}` },
    });

    /* 204 = nothing playing, 401 = token expired */
    if (res.status === 204 || res.status === 401) {
      hideSpotifyBar();
      if (res.status === 401) {
        /* Token expired — clear and let user reconnect */
        clearInterval(State.spPollTimer);
        State.spotifyToken = null;
        updateSpotifyStatusUI(false);
        toast('⚠ Spotify token expired — reconnect');
      }
      return;
    }

    if (!res.ok) return;

    const data = await res.json();

    /* Show bar only when actually playing */
    if (!data.is_playing || !data.item) {
      hideSpotifyBar();
      return;
    }

    const track    = data.item.name;
    const artist   = data.item.artists.map(a => a.name).join(', ');
    const artUrl   = data.item.album?.images?.[0]?.url || '';
    const progress = data.progress_ms  || 0;
    const duration = data.item.duration_ms || 1;

    showSpotifyBar(track, artist, artUrl, progress / duration);
  } catch (e) {
    /* Network error — just wait for next poll */
    console.warn('[Spotify poll]', e);
  }
}

function showSpotifyBar(track, artist, artUrl, progressRatio) {
  document.getElementById('sp-track').textContent  = track;
  document.getElementById('sp-artist').textContent = artist;

  const artEl = document.getElementById('sp-art');
  artEl.src = artUrl;
  artEl.style.display = artUrl ? 'block' : 'none';

  /* Sync progress bar */
  document.getElementById('sp-progress-fill').style.width =
    `${Math.round(progressRatio * 100)}%`;

  document.getElementById('spotify-bar').classList.remove('sp-hidden');
}

function hideSpotifyBar() {
  document.getElementById('spotify-bar').classList.add('sp-hidden');
}

function updateSpotifyStatusUI(connected) {
  const status = document.getElementById('sp-conn-status');
  const disBtn = document.getElementById('sp-disconnect-btn');
  const conBtn = document.getElementById('sp-connect-btn');
  if (!status) return;  /* settings panel may not be open */
  if (connected) {
    status.style.display = 'block';
    disBtn.style.display = 'block';
    conBtn.style.display = 'none';
  } else {
    status.style.display = 'none';
    disBtn.style.display = 'none';
    conBtn.style.display = 'block';
  }
}

/* ══════════════════════════════════════════════════════════
   PARTICLES
══════════════════════════════════════════════════════════ */
const canvas = document.getElementById('bg-canvas');
const ctx    = canvas.getContext('2d');
let particles  = [];
let _animFrame = null;

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
  particles = Array.from({length:n}, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height,
    vx: (Math.random()-.5) * .65,
    vy: (Math.random()-.5) * .65,
    r:  Math.random() * 1.8 + .8,
  }));
}

function drawFrame() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const MAX = 135;

  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0)             p.x = canvas.width;
    if (p.x > canvas.width)  p.x = 0;
    if (p.y < 0)             p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = hexRgba(State.particleColor, .9);
    ctx.fill();
  }

  for (let i=0; i<particles.length; i++) {
    for (let j=i+1; j<particles.length; j++) {
      const dx   = particles[i].x - particles[j].x;
      const dy   = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < MAX) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = hexRgba(State.particleColor, (1 - dist/MAX)*.45);
        ctx.lineWidth = .7;
        ctx.stroke();
      }
    }
  }
  _animFrame = requestAnimationFrame(drawFrame);
}

function startParticles() {
  if (_animFrame) cancelAnimationFrame(_animFrame);
  canvas.style.display = 'block';
  initParticles();
  drawFrame();
}

function stopParticles() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  ctx.clearRect(0,0,canvas.width,canvas.height);
  canvas.style.display = 'none';
}

window.addEventListener('resize', () => {
  if (State.bgMode === 'particles') { resizeCanvas(); initParticles(); }
});

/* ══════════════════════════════════════════════════════════
   BACKGROUND MODES  — all live, no storage
══════════════════════════════════════════════════════════ */
function setBgMode(mode) {
  State.bgMode = mode;

  stopParticles();
  const vid   = document.getElementById('bg-video');
  const photo = document.getElementById('bg-photo-layer');
  vid.pause();
  vid.removeAttribute('src');
  vid.load();
  vid.style.display   = 'none';
  photo.style.display = 'none';

  document.querySelectorAll('.bg-opt').forEach(
    btn => btn.classList.toggle('active', btn.dataset.mode === mode)
  );

  renderBgSub(mode);

  if (mode === 'particles') startParticles();
}

function renderBgSub(mode) {
  const sub = document.getElementById('bg-sub');
  sub.innerHTML = '';

  if (mode === 'particles') {
    sub.innerHTML = `
      <div class="color-row">
        <label>Particle colour</label>
        <input type="color" id="pcolor" value="${State.particleColor}"/>
        <span style="font-size:.78rem;color:var(--muted)" id="pcolor-hex">${State.particleColor}</span>
      </div>`;
    document.getElementById('pcolor').addEventListener('input', e => {
      State.particleColor = e.target.value;
      document.getElementById('pcolor-hex').textContent = e.target.value;
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
        Click to choose a video file
      </button>`;
    document.getElementById('video-upload-btn').addEventListener('click', () => {
      document.getElementById('picker-video').click();
    });
  }

  if (mode === 'photo') {
    sub.innerHTML = `
      <button class="upload-btn" id="photo-upload-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Click to choose a photo file
      </button>`;
    document.getElementById('photo-upload-btn').addEventListener('click', () => {
      document.getElementById('picker-photo').click();
    });
  }
}

/* File picker handlers — apply live the moment a file is chosen */
document.getElementById('picker-video').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const vid = document.getElementById('bg-video');
  vid.src = url;
  vid.style.display = 'block';
  vid.load();
  vid.play();
  toast('✓ Video background applied');
});

document.getElementById('picker-photo').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const layer = document.getElementById('bg-photo-layer');
  layer.style.backgroundImage = `url(${url})`;
  layer.style.display = 'block';
  toast('✓ Photo background applied');
});

/* ══════════════════════════════════════════════════════════
   ADMIN MODAL
══════════════════════════════════════════════════════════ */
document.getElementById('admin-trigger').addEventListener('click', async () => {
  await ensureCredentials();
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

  /* Pre-fill Spotify fields if we already have them */
  if (State.spClientId)
    document.getElementById('sp-client-id').value = State.spClientId;
  if (State.spRedirect)
    document.getElementById('sp-redirect').value  = State.spRedirect;

  /* Refresh bg sub-settings for current mode */
  renderBgSub(State.bgMode);
  document.querySelectorAll('.bg-opt').forEach(
    btn => btn.classList.toggle('active', btn.dataset.mode === State.bgMode)
  );

  /* Restore Spotify connection status if token still live */
  updateSpotifyStatusUI(!!State.spotifyToken);
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
  if (await verifyCredentials(user, pass)) {
    document.getElementById('login-error').style.display = 'none';
    showSettingsView();
  } else {
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('adm-pass').value = '';
  }
}

/* Logout */
document.getElementById('logout-btn').addEventListener('click', () => {
  showLoginView();
  toast('Logged out');
});

/* Background buttons */
document.getElementById('bg-options').addEventListener('click', e => {
  const btn = e.target.closest('.bg-opt');
  if (btn) setBgMode(btn.dataset.mode);
});

/* Spotify connect / disconnect */
document.getElementById('sp-connect-btn').addEventListener('click', connectSpotify);
document.getElementById('sp-disconnect-btn').addEventListener('click', disconnectSpotify);

/* Display name — live update, no storage */
document.getElementById('update-name-btn').addEventListener('click', () => {
  const v = document.getElementById('edit-name').value.trim();
  if (!v) return;
  document.getElementById('display-name').textContent = v;
  toast('✓ Name updated live');
});

/* Change credentials */
document.getElementById('save-creds-btn').addEventListener('click', async () => {
  const u = document.getElementById('new-user').value.trim();
  const p = document.getElementById('new-pass').value;
  if (!u || !p) { toast('⚠ Fill both fields'); return; }
  await changeCredentials(u, p);
  document.getElementById('new-user').value = '';
  document.getElementById('new-pass').value = '';
  toast('✓ Credentials saved (this session)');
});

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
(async function init() {
  await ensureCredentials();

  /* Start with particles */
  setBgMode('particles');

  /* Load GitHub data */
  loadGitHub();

  /* Check if returning from Spotify OAuth redirect */
  handleSpotifyCallback();
})();

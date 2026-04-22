/* ═══════════════════════════════════════════════════════════════
   app.js  —  UNKNOWN Profile · Full Logic
   Credentials: username = Mimo_Amr  |  password = Mimo
   All passwords stored as SHA-256 hashes (SubtleCrypto API)
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const GITHUB_USER    = 'mimo-amr';
const DEFAULT_USER   = 'Mimo_Amr';
const DEFAULT_PASS   = 'Mimo';

/* Language dot colours (GitHub palette) */
const LANG_COLORS = {
  JavaScript:  '#f1e05a', TypeScript: '#3178c6', Python:   '#3572A5',
  HTML:        '#e34c26', CSS:        '#563d7c', Java:     '#b07219',
  Ruby:        '#701516', Go:         '#00ADD8', Rust:     '#dea584',
  C:           '#555555', 'C++':      '#f34b7d', 'C#':     '#178600',
  PHP:         '#4F5D95', Swift:      '#F05138', Kotlin:   '#A97BFF',
  Dart:        '#00B4AB', Shell:      '#89e051', Vue:      '#41b883',
  Svelte:      '#ff3e00', Lua:        '#000080', SCSS:     '#c6538c',
};

/* ─────────────────────────────────────────
   SHA-256 HELPER (SubtleCrypto — browser-native)
───────────────────────────────────────── */
async function sha256(str) {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ─────────────────────────────────────────
   CREDENTIAL STORAGE
   Hashes are stored in localStorage so the
   plain-text password never persists.
───────────────────────────────────────── */
let credInitialized = false;

async function ensureCredentials() {
  if (credInitialized) return;
  credInitialized = true;
  if (!localStorage.getItem('adm_u_hash')) {
    localStorage.setItem('adm_u_hash', await sha256(DEFAULT_USER));
  }
  if (!localStorage.getItem('adm_p_hash')) {
    localStorage.setItem('adm_p_hash', await sha256(DEFAULT_PASS));
  }
}

async function verifyCredentials(user, pass) {
  await ensureCredentials();
  const uh = await sha256(user);
  const ph = await sha256(pass);
  return (
    uh === localStorage.getItem('adm_u_hash') &&
    ph === localStorage.getItem('adm_p_hash')
  );
}

async function updateCredentials(user, pass) {
  localStorage.setItem('adm_u_hash', await sha256(user));
  localStorage.setItem('adm_p_hash', await sha256(pass));
}

/* ─────────────────────────────────────────
   TOAST
───────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ─────────────────────────────────────────
   GITHUB — profile + repos + license
───────────────────────────────────────── */
async function loadGitHub() {
  try {
    const [profileRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${GITHUB_USER}`),
      fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated`)
    ]);
    const profile = await profileRes.json();
    const repos   = await reposRes.json();

    /* Avatar */
    if (profile.avatar_url) {
      document.getElementById('avatar').src = profile.avatar_url;
    }

    /* Stats */
    setStat('stat-repos',     profile.public_repos, 'repos');
    setStat('stat-followers', profile.followers,    'followers');
    setStat('stat-following', profile.following,    'following');

    /* Repos */
    renderRepos(repos);

    /* License */
    renderLicense(repos);

  } catch (err) {
    console.warn('[GitHub] Failed to load:', err);
    document.getElementById('repos-grid').innerHTML =
      '<p style="color:var(--muted);font-size:.85rem;padding:10px">Could not reach GitHub API.</p>';
    document.getElementById('license-name').textContent = 'Unavailable';
    document.getElementById('license-body').textContent =
      'Could not fetch license data. Check your connection.';
  }
}

function setStat(id, value, label) {
  const el = document.getElementById(id);
  el.innerHTML = `<b>${value ?? '—'}</b><span>${label}</span>`;
}

function renderRepos(repos) {
  const grid = document.getElementById('repos-grid');
  grid.innerHTML = '';

  const sorted = [...repos].sort(
    (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)
  );

  sorted.forEach(r => {
    const color = LANG_COLORS[r.language] || '#888';
    const dot   = r.language
      ? `<span class="lang-dot" style="background:${color}"></span>${r.language}`
      : '';

    const card = document.createElement('a');
    card.href      = r.html_url;
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';
    card.className = 'repo-card glass';
    card.innerHTML = `
      <div class="repo-name">${escHtml(r.name)}</div>
      <div class="repo-desc">${
        r.description
          ? escHtml(r.description)
          : '<em style="opacity:.38">No description</em>'
      }</div>
      <div class="repo-meta">
        ${dot ? `<span>${dot}</span>` : ''}
        <span>★ ${r.stargazers_count || 0}</span>
        <span>⑂ ${r.forks_count || 0}</span>
      </div>`;
    grid.appendChild(card);
  });
}

function renderLicense(repos) {
  const licRepo = repos.find(r => r.license);
  const nameEl  = document.getElementById('license-name');
  const bodyEl  = document.getElementById('license-body');
  if (licRepo) {
    nameEl.textContent = licRepo.license.name;
    bodyEl.textContent =
      `Applied in "${licRepo.name}".  SPDX: ${licRepo.license.spdx_id || 'N/A'}.`;
  } else {
    nameEl.textContent = 'No License Detected';
    bodyEl.textContent = 'None of the public repositories carry a recognized license file.';
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─────────────────────────────────────────
   SPOTIFY BAR
───────────────────────────────────────── */
function updateSpotifyUI(track, artist, artUrl) {
  document.getElementById('spotify-track').textContent  = track  || 'Not Playing';
  document.getElementById('spotify-artist').textContent = artist || 'Spotify';
  const artEl = document.getElementById('spotify-art');
  if (artUrl) {
    artEl.src   = artUrl;
    artEl.style.display = 'block';
  } else {
    artEl.src   = '';
    artEl.style.display = 'none';
  }
  const fill = document.getElementById('progress-fill');
  if (track) {
    fill.classList.add('playing');
    fill.style.animation = 'none';
    void fill.offsetWidth;           // reflow to restart
    fill.style.animation = '';
    fill.classList.add('playing');
  } else {
    fill.classList.remove('playing');
    fill.style.width = '0%';
  }
}

/* Persist Spotify state */
function saveSpotify(track, artist, art) {
  localStorage.setItem('sp_track',  track);
  localStorage.setItem('sp_artist', artist);
  localStorage.setItem('sp_art',    art);
}

function loadSpotify() {
  const t = localStorage.getItem('sp_track')  || '';
  const a = localStorage.getItem('sp_artist') || '';
  const i = localStorage.getItem('sp_art')    || '';
  if (t) updateSpotifyUI(t, a, i);
}

/* ─────────────────────────────────────────
   PARTICLES
───────────────────────────────────────── */
const canvas = document.getElementById('bg-canvas');
const ctx    = canvas.getContext('2d');
let   particles    = [];
let   animFrameId  = null;
let   particleHex  = '#a8edea';

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initParticles() {
  resizeCanvas();
  const count = Math.min(
    160,
    Math.floor((canvas.width * canvas.height) / 11000)
  );
  particles = Array.from({ length: count }, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.65,
    vy: (Math.random() - 0.5) * 0.65,
    r:  Math.random() * 1.8 + 0.8,
  }));
}

function drawParticleFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  /* Black background behind overlay */
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const MAX_DIST = 130;

  /* Move & draw dots */
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0)            p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0)            p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(particleHex, 0.9);
    ctx.fill();
  }

  /* Draw connecting lines */
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx   = particles[i].x - particles[j].x;
      const dy   = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAX_DIST) {
        const alpha = (1 - dist / MAX_DIST) * 0.45;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = hexToRgba(particleHex, alpha);
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  animFrameId = requestAnimationFrame(drawParticleFrame);
}

function startParticles() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  canvas.style.display = 'block';
  initParticles();
  drawParticleFrame();
}

function stopParticles() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = 'none';
}

window.addEventListener('resize', () => {
  if (currentBgMode === 'particles') {
    resizeCanvas();
    initParticles();
  }
});

/* ─────────────────────────────────────────
   BACKGROUND MODES
───────────────────────────────────────── */
let currentBgMode = 'particles';

function setBgMode(mode) {
  currentBgMode = mode;

  /* Deactivate everything */
  stopParticles();
  const vid   = document.getElementById('bg-video');
  const photo = document.getElementById('bg-photo-layer');
  vid.style.display   = 'none';
  photo.style.display = 'none';
  vid.src = '';

  /* Highlight active button */
  document.querySelectorAll('.bg-opt').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );

  /* Render sub-settings */
  renderBgSub(mode);

  /* Activate mode */
  if (mode === 'particles') {
    startParticles();
  }

  localStorage.setItem('bg_mode', mode);
}

function renderBgSub(mode) {
  const sub = document.getElementById('bg-sub');
  sub.innerHTML = '';

  if (mode === 'particles') {
    sub.innerHTML = `
      <div class="color-row">
        <label class="field-label" style="margin:0">PARTICLE COLOUR</label>
        <input type="color" id="particle-color-picker" value="${particleHex}"/>
        <span style="font-size:.8rem;color:var(--muted)" id="particle-hex-label">${particleHex}</span>
      </div>`;
    document.getElementById('particle-color-picker').addEventListener('input', e => {
      particleHex = e.target.value;
      document.getElementById('particle-hex-label').textContent = particleHex;
      localStorage.setItem('particle_color', particleHex);
    });
  }

  if (mode === 'video') {
    sub.innerHTML = `
      <div class="field-group">
        <label class="field-label">UPLOAD VIDEO</label>
        <input type="file" id="video-upload" accept="video/*"/>
      </div>`;
    document.getElementById('video-upload').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const vid = document.getElementById('bg-video');
      vid.src = url;
      vid.style.display = 'block';
      vid.load(); vid.play();
      toast('✓ Video background set');
    });
  }

  if (mode === 'photo') {
    sub.innerHTML = `
      <div class="field-group">
        <label class="field-label">UPLOAD PHOTO</label>
        <input type="file" id="photo-upload" accept="image/*"/>
      </div>`;
    document.getElementById('photo-upload').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const layer = document.getElementById('bg-photo-layer');
      layer.style.backgroundImage = `url(${url})`;
      layer.style.display = 'block';
      toast('✓ Photo background set');
    });
  }
}

/* ─────────────────────────────────────────
   ADMIN MODAL
───────────────────────────────────────── */
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
  showLogin();
}

function showLogin() {
  document.getElementById('login-view').style.display    = 'flex';
  document.getElementById('settings-view').style.display = 'none';
}

function showSettings() {
  document.getElementById('login-view').style.display    = 'none';
  document.getElementById('settings-view').style.display = 'flex';
  /* Sync fields */
  document.getElementById('edit-track').value  = localStorage.getItem('sp_track')  || '';
  document.getElementById('edit-artist').value = localStorage.getItem('sp_artist') || '';
  document.getElementById('edit-art').value    = localStorage.getItem('sp_art')    || '';
  document.getElementById('edit-name').value   = document.getElementById('display-name').textContent;
  /* Re-render BG sub-settings for current mode */
  setBgMode(currentBgMode);
}

/* Login */
document.getElementById('login-btn').addEventListener('click', async () => {
  const user = document.getElementById('adm-user').value.trim();
  const pass = document.getElementById('adm-pass').value;
  if (!user || !pass) return;

  const ok = await verifyCredentials(user, pass);
  if (ok) {
    document.getElementById('login-error').style.display = 'none';
    showSettings();
  } else {
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('adm-pass').value = '';
  }
});

/* Allow Enter key on login fields */
['adm-user','adm-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
});

/* Logout */
document.getElementById('logout-btn').addEventListener('click', () => {
  showLogin();
  toast('Logged out');
});

/* Update Spotify */
document.getElementById('update-spotify-btn').addEventListener('click', () => {
  const track  = document.getElementById('edit-track').value.trim();
  const artist = document.getElementById('edit-artist').value.trim();
  const art    = document.getElementById('edit-art').value.trim();
  updateSpotifyUI(track, artist, art);
  saveSpotify(track, artist, art);
  toast('✓ Spotify updated');
});

/* Update Name */
document.getElementById('update-name-btn').addEventListener('click', () => {
  const val = document.getElementById('edit-name').value.trim();
  if (!val) return;
  document.getElementById('display-name').textContent = val;
  localStorage.setItem('display_name', val);
  toast('✓ Name updated');
});

/* Save new credentials */
document.getElementById('save-creds-btn').addEventListener('click', async () => {
  const user = document.getElementById('new-user').value.trim();
  const pass = document.getElementById('new-pass').value;
  if (!user || !pass) { toast('⚠ Fill both fields'); return; }
  await updateCredentials(user, pass);
  document.getElementById('new-user').value = '';
  document.getElementById('new-pass').value = '';
  toast('✓ Credentials saved');
});

/* ─────────────────────────────────────────
   PERSIST — restore state on load
───────────────────────────────────────── */
function restoreState() {
  const name = localStorage.getItem('display_name');
  if (name) document.getElementById('display-name').textContent = name;

  particleHex = localStorage.getItem('particle_color') || '#a8edea';

  const savedMode = localStorage.getItem('bg_mode') || 'particles';
  /* We'll set mode after DOM is ready */
  setTimeout(() => setBgMode(savedMode), 0);
}

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
(async function init() {
  await ensureCredentials();
  restoreState();
  loadGitHub();
  loadSpotify();
})();

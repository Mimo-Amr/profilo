'use strict';

const GITHUB_USER = 'mimo-amr';

const LANG_COLORS = {
  JavaScript:'#f1e05a',TypeScript:'#3178c6',Python:'#3572A5',
  HTML:'#e34c26',CSS:'#563d7c',Java:'#b07219',Ruby:'#701516',
  Go:'#00ADD8',Rust:'#dea584',C:'#555555','C++':'#f34b7d',
  'C#':'#178600',PHP:'#4F5D95',Swift:'#F05138',Kotlin:'#A97BFF',
  Dart:'#00B4AB',Shell:'#89e051',Vue:'#41b883',Svelte:'#ff3e00',
};

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

let sessionHashes = null;

let _tt;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), 2800);
}

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(path, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
  });
  return res.json();
}
async function saveSetting(updates) {
  if (!sessionHashes) return;
  try { return await apiPost('/api/settings', {...sessionHashes,...updates}); }
  catch(e) { console.warn('[save]',e); }
}

/* ── Loader ── */
function showPage() {
  const loader = document.getElementById('loader');
  loader.classList.add('fade-out');
  setTimeout(() => loader.style.display = 'none', 750);
  document.getElementById('page').classList.add('page-visible');
  document.getElementById('admin-trigger').classList.add('page-visible');
}

/* ── State polling ── */
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
  } catch(e) {}
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
  } catch(e) { console.warn('[github]',e); }
}
function setStat(id, val, label) {
  document.getElementById(id).innerHTML = `<b>${val ?? '—'}</b><span>${label}</span>`;
}
function renderRepos(repos) {
  const grid = document.getElementById('repos-grid');
  grid.innerHTML = '';
  [...repos].sort((a,b) => (b.stargazers_count||0)-(a.stargazers_count||0)).forEach(r => {
    const col = LANG_COLORS[r.language]||'#888';
    const card = document.createElement('a');
    card.href = r.html_url; card.target = '_blank'; card.rel = 'noopener noreferrer';
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
  document.getElementById('license-name').textContent = lr ? lr.license.name : 'No License Detected';
  document.getElementById('license-body').textContent = lr
    ? `Applied in "${lr.name}". SPDX: ${lr.license.spdx_id||'N/A'}.`
    : 'None of the public repositories carry a recognized license file.';
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ════════════════════════════════════════
   NOW PLAYING BAR
   - Always visible once a track is known
   - Green "NOW PLAYING" dot when active
   - Gray "LAST PLAYED" dot when stopped
════════════════════════════════════════ */
let barVisible = false;

function showBar() {
  const bar = document.getElementById('now-playing-bar');
  bar.classList.add('visible');
  barVisible = true;
}

function setBarPlaying(track, artist, art) {
  document.getElementById('np-track').textContent  = track  || '—';
  document.getElementById('np-artist').textContent = artist || '—';

  const artEl = document.getElementById('np-art');
  if (art && art.trim() && !art.includes('2a96cbd8b46e442fc41c2b86b821562f')) {
    artEl.src = art;
    artEl.classList.add('has-art');
  } else {
    artEl.classList.remove('has-art');
  }

  const status = document.getElementById('np-status');
  const label  = document.getElementById('np-status-label');
  status.className = 'playing';
  label.textContent = 'NOW PLAYING';
  showBar();
}

function setBarStopped(track, artist, art) {
  if (!track) return; // nothing to show yet
  document.getElementById('np-track').textContent  = track  || '—';
  document.getElementById('np-artist').textContent = artist || '—';

  const artEl = document.getElementById('np-art');
  if (art && art.trim() && !art.includes('2a96cbd8b46e442fc41c2b86b821562f')) {
    artEl.src = art;
    artEl.classList.add('has-art');
  } else {
    artEl.classList.remove('has-art');
  }

  const status = document.getElementById('np-status');
  const label  = document.getElementById('np-status-label');
  status.className = 'stopped';
  label.textContent = 'LAST PLAYED';
  showBar();
}

async function pollNowPlaying() {
  try {
    const res = await fetch('/api/now-playing');
    if (!res.ok) return;
    const d = await res.json();
    if (d.playing) {
      setBarPlaying(d.track, d.artist, d.art);
    } else {
      setBarStopped(d.last_track, d.last_artist, d.last_art);
    }
  } catch(e) {}
}

/* ════════════════════════════════════════
   PARTICLES
════════════════════════════════════════ */
const canvas = document.getElementById('bg-canvas');
const ctx    = canvas.getContext('2d');
let particles = [], animFrame = null, particleColor = '#a8edea', currentBgMode = 'particles';

function hexRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function resizeCanvas() { canvas.width = innerWidth; canvas.height = innerHeight; }
function initParticles() {
  resizeCanvas();
  const n = Math.min(160, Math.floor((canvas.width * canvas.height) / 10000));
  particles = Array.from({length:n}, () => ({
    x:Math.random()*canvas.width, y:Math.random()*canvas.height,
    vx:(Math.random()-.5)*.65,    vy:(Math.random()-.5)*.65,
    r:Math.random()*1.8+.8,
  }));
}
function drawFrame() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const MAX=135;
  for (const p of particles) {
    p.x+=p.vx; p.y+=p.vy;
    if(p.x<0) p.x=canvas.width;  if(p.x>canvas.width)  p.x=0;
    if(p.y<0) p.y=canvas.height; if(p.y>canvas.height) p.y=0;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fillStyle=hexRgba(particleColor,.9); ctx.fill();
  }
  for (let i=0;i<particles.length;i++) for (let j=i+1;j<particles.length;j++) {
    const dx=particles[i].x-particles[j].x, dy=particles[i].y-particles[j].y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<MAX){
      ctx.beginPath();
      ctx.moveTo(particles[i].x,particles[i].y);
      ctx.lineTo(particles[j].x,particles[j].y);
      ctx.strokeStyle=hexRgba(particleColor,(1-dist/MAX)*.45);
      ctx.lineWidth=.7; ctx.stroke();
    }
  }
  animFrame = requestAnimationFrame(drawFrame);
}
function startParticles() {
  if(animFrame) cancelAnimationFrame(animFrame);
  canvas.style.display='block'; initParticles(); drawFrame();
}
function stopParticles() {
  if(animFrame){cancelAnimationFrame(animFrame);animFrame=null;}
  ctx.clearRect(0,0,canvas.width,canvas.height);
  canvas.style.display='none';
}
window.addEventListener('resize',()=>{ if(currentBgMode==='particles'){resizeCanvas();initParticles();} });

/* ════════════════════════════════════════
   BACKGROUND MODES + R2 UPLOAD
════════════════════════════════════════ */
function setBgMode(mode, save=true) {
  currentBgMode = mode; stopParticles();
  const vid=document.getElementById('bg-video'), photo=document.getElementById('bg-photo-layer');
  vid.pause(); vid.removeAttribute('src'); vid.load();
  vid.style.display='none'; photo.style.display='none';
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.mode===mode));
  renderBgSub(mode);
  if(mode==='particles') startParticles();
  if(save) saveSetting({bg_mode:mode});
}

function setBgVideo(url) {
  const vid = document.getElementById('bg-video');
  vid.src = url; vid.style.display = 'block'; vid.load(); vid.play();
}

function setBgPhoto(url) {
  const layer = document.getElementById('bg-photo-layer');
  layer.style.backgroundImage = `url(${url})`; layer.style.display = 'block';
}

async function uploadMediaToR2(file, type) {
  if (!sessionHashes) { toast('⚠ Login first'); return null; }

  const bar  = document.getElementById(`${type}-progress`);
  const fill = document.getElementById(`${type}-progress-fill`);
  if (bar) { bar.style.display='block'; fill.style.width='10%'; }

  const auth = `${sessionHashes.u_hash}:${sessionHashes.p_hash}`;
  const ct   = file.type || (type==='video' ? 'video/mp4' : 'image/jpeg');

  try {
    if (bar) fill.style.width = '40%';
    const res = await fetch(`/api/media/upload?type=${type}&auth=${encodeURIComponent(auth)}`, {
      method: 'PUT',
      headers: { 'Content-Type': ct },
      body: file,
    });
    if (bar) fill.style.width = '90%';
    const data = await res.json();
    if (bar) { fill.style.width='100%'; setTimeout(()=>bar.style.display='none',600); }
    if (!res.ok || !data.ok) {
      if (data.error && data.error.includes('R2 not configured')) {
        toast('⚠ R2 not enabled yet — see instructions below');
      } else {
        toast('✕ Upload failed: ' + (data.error||res.status));
      }
      return null;
    }
    return data.url;
  } catch(e) {
    if (bar) bar.style.display='none';
    toast('✕ Upload error — R2 may not be enabled');
    return null;
  }
}

function renderBgSub(mode) {
  const sub = document.getElementById('bg-sub');
  sub.innerHTML = '';

  if (mode==='particles') {
    sub.innerHTML = `<div class="color-row">
      <label>Particle colour</label>
      <input type="color" id="pcolor" value="${particleColor}"/>
      <span style="font-size:.76rem;color:var(--muted)" id="pcolor-hex">${particleColor}</span>
    </div>`;
    document.getElementById('pcolor').addEventListener('input', e => {
      particleColor = e.target.value;
      document.getElementById('pcolor-hex').textContent = e.target.value;
      saveSetting({particle_color: e.target.value});
    });
  }

  if (mode==='video') {
    sub.innerHTML = `
      <button class="upload-btn" id="video-upload-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Click to choose a video file…
      </button>
      <div class="upload-progress" id="video-progress">
        <div class="upload-progress-fill" id="video-progress-fill"></div>
      </div>
      <p style="font-size:.7rem;color:var(--muted);margin-top:8px">Video uploads to R2 and persists for all visitors. Requires R2 to be enabled.</p>`;
    document.getElementById('video-upload-btn').addEventListener('click', () =>
      document.getElementById('picker-video').click());
  }

  if (mode==='photo') {
    sub.innerHTML = `
      <button class="upload-btn" id="photo-upload-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Click to choose a photo file…
      </button>
      <div class="upload-progress" id="photo-progress">
        <div class="upload-progress-fill" id="photo-progress-fill"></div>
      </div>
      <p style="font-size:.7rem;color:var(--muted);margin-top:8px">Photo uploads to R2 and persists for all visitors. Requires R2 to be enabled.</p>`;
    document.getElementById('photo-upload-btn').addEventListener('click', () =>
      document.getElementById('picker-photo').click());
  }
}

/* File picker handlers — upload to R2, apply live, persist for everyone */
document.getElementById('picker-video').addEventListener('change', async function() {
  const file = this.files[0]; if(!file) return;
  // Apply locally immediately
  setBgVideo(URL.createObjectURL(file));
  toast('Uploading video…');
  const url = await uploadMediaToR2(file, 'video');
  if (url) toast('✓ Video uploaded — live for everyone');
});

document.getElementById('picker-photo').addEventListener('change', async function() {
  const file = this.files[0]; if(!file) return;
  // Apply locally immediately
  setBgPhoto(URL.createObjectURL(file));
  toast('Uploading photo…');
  const url = await uploadMediaToR2(file, 'photo');
  if (url) toast('✓ Photo uploaded — live for everyone');
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
  if(e.target === document.getElementById('admin-modal')) closeAdmin();
});
function closeAdmin() {
  document.getElementById('admin-modal').classList.remove('open');
  showLoginView();
}
function showLoginView() {
  document.getElementById('login-view').style.display  = 'flex';
  document.getElementById('settings-view').style.display = 'none';
}
async function showSettingsView() {
  document.getElementById('login-view').style.display    = 'none';
  document.getElementById('settings-view').style.display = 'flex';
  document.getElementById('edit-name').value = document.getElementById('display-name').textContent;
  renderBgSub(currentBgMode);
  document.querySelectorAll('.bg-opt').forEach(b => b.classList.toggle('active', b.dataset.mode===currentBgMode));
  try {
    const s = await apiGet('/api/state');
    if(s.lastfm_user)    document.getElementById('lfm-user').value = s.lastfm_user;
    if(s.lastfm_api_key) document.getElementById('lfm-key').value  = s.lastfm_api_key;
    if(s.particle_color) { particleColor=s.particle_color; _lastColor=s.particle_color; }
  } catch(e) {}
}

/* ── Login ── */
document.getElementById('login-btn').addEventListener('click', attemptLogin);
['adm-user','adm-pass'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') attemptLogin(); })
);
async function attemptLogin() {
  const user  = document.getElementById('adm-user').value.trim();
  const pass  = document.getElementById('adm-pass').value;
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  if(!user||!pass) return;
  btn.textContent='Verifying…'; btn.disabled=true; errEl.style.display='none';
  try {
    const u_hash = await sha256(user);
    const p_hash = await sha256(pass);
    const result = await apiPost('/api/auth', {u_hash,p_hash});
    if(result && result.ok) {
      sessionHashes = {u_hash,p_hash};
      showSettingsView();
    } else {
      errEl.textContent = '✕ Wrong username or password';
      errEl.style.display = 'block';
      document.getElementById('adm-pass').value = '';
      sessionHashes = null;
    }
  } catch(e) {
    errEl.textContent = '✕ Cannot reach server';
    errEl.style.display = 'block';
    console.error('[login]',e);
  } finally {
    btn.textContent = 'UNLOCK →'; btn.disabled = false;
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionHashes = null; showLoginView(); toast('Logged out');
});

document.getElementById('bg-options').addEventListener('click', e => {
  const b = e.target.closest('.bg-opt'); if(b) setBgMode(b.dataset.mode);
});

document.getElementById('update-name-btn').addEventListener('click', async () => {
  const v = document.getElementById('edit-name').value.trim(); if(!v) return;
  document.getElementById('display-name').textContent = v; _lastName = v;
  const r = await saveSetting({display_name:v});
  toast(r&&r.ok ? '✓ Name saved — live for everyone' : '✕ Save failed');
});

document.getElementById('save-lastfm-btn').addEventListener('click', async () => {
  const user = document.getElementById('lfm-user').value.trim();
  const key  = document.getElementById('lfm-key').value.trim();
  if(!user||!key) { toast('⚠ Fill both Last.fm fields'); return; }
  const r = await saveSetting({lastfm_user:user, lastfm_api_key:key});
  if(r&&r.ok) { toast('✓ Last.fm saved — polling now'); pollNowPlaying(); }
  else toast('✕ Save failed');
});

document.getElementById('save-creds-btn').addEventListener('click', async () => {
  const u = document.getElementById('new-user').value.trim();
  const p = document.getElementById('new-pass').value;
  if(!u||!p) { toast('⚠ Fill both fields'); return; }
  try {
    const new_u_hash = await sha256(u), new_p_hash = await sha256(p);
    const r = await apiPost('/api/credentials', {...sessionHashes, new_u_hash, new_p_hash});
    if(r&&r.ok) {
      sessionHashes = {u_hash:new_u_hash, p_hash:new_p_hash};
      document.getElementById('new-user').value = '';
      document.getElementById('new-pass').value = '';
      toast('✓ Credentials updated');
    } else toast('✕ Failed');
  } catch(e) { toast('✕ Error'); }
});

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
(async function init() {
  setBgMode('particles', false);

  const [_, stateResult] = await Promise.allSettled([
    loadGitHub(),
    apiGet('/api/state').catch(() => null),
  ]);

  const s = stateResult.value;
  if(s) {
    if(s.display_name)  { document.getElementById('display-name').textContent=s.display_name; _lastName=s.display_name; }
    if(s.particle_color){ particleColor=s.particle_color; _lastColor=s.particle_color; }

    // Restore persisted background
    if(s.bg_mode==='video' && s.bg_media_url) {
      currentBgMode = 'video'; stopParticles();
      setBgVideo(s.bg_media_url);
    } else if(s.bg_mode==='photo' && s.bg_media_url) {
      currentBgMode = 'photo'; stopParticles();
      setBgPhoto(s.bg_media_url);
    }

    // Show last played immediately from D1
    if(s.last_track) setBarStopped(s.last_track, s.last_artist, s.last_art);
  }

  showPage();

  setInterval(pollState, 3000);
  pollNowPlaying();
  setInterval(pollNowPlaying, 10000);
})();

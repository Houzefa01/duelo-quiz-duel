// Duelo cartoon : routeur hash, écrans légers, SVG via <img>/<use> uniquement.
import { api } from './api.js';
import { live } from './socket.js';
const app = document.getElementById('app');
const say = (t) => { document.getElementById('live').textContent = t; };
const AVATARS = [
...['a1','a2','a3','a4','a5','a6','a7','a8','a9','a10','a11','a12','a13','a14'].map((n) => ({ f: `personnage-${n}.svg`, cat: 'personnages' })),
...['p1','p2','p3','p4','p5','p6'].map((n) => ({ f: `personnage-${n}.svg`, cat: 'personnages' })),
...['n1','n2','n3','n4','n5','n6','n7','n8'].map((n) => ({ f: `clas-${n}.svg`, cat: 'personnages' })),
...['o1','o2','o3','o4','o5','o6','o7','o8'].map((n) => ({ f: `fanta-${n}.svg`, cat: 'fantaisie' })),
...['l1','l2','l3','l4'].map((n) => ({ f: `fanta-${n}.svg`, cat: 'fantaisie' })),
...['e1','e2','e3','e4'].map((n) => ({ f: `creat-${n}.svg`, cat: 'creatures' })),
...['chat','chien','renard','panda','grenouille','abeille','poisson','lion','tigre','lapin','koala','hibou'].map((n) => ({ f: `anim-${n}.svg`, cat: 'animaux' })),
];
const DEFAUT_AVATAR = 'personnage-a1.svg';
const icon = (n) => `<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#${n}"/></svg>`;
function avatarUrl(u) {
  if (u && u.avatar_kind === 'upload' && u.avatar_ref) return `/api/v1/avatar/photo/${encodeURIComponent(u.avatar_ref)}`;
  const f = (u && u.avatar_ref && AVATARS.some((a) => a.f === u.avatar_ref)) ? u.avatar_ref : DEFAUT_AVATAR;
  return `/assets/avatars/${f}`;
}
const avatarImg = (u, cls = '') => `<img class="${cls}" src="${avatarUrl(u)}" alt="Avatar de ${esc(u?.username ?? 'joueur')}" loading="lazy" onerror="this.onerror=null;this.src='/assets/avatars/${DEFAUT_AVATAR}'">`;
const mascotte = (humeur, bulle, petite = false) => `<div class="mascotte${petite ? ' petite' : ''}"><img id="masc" src="/assets/mascotte/mascotte-${humeur}.svg" alt="Mascotte Duelo"><div class="bulle">${bulle}</div></div>`;
const logged = () => document.cookie.split(';').some((c) => c.trim().startsWith('session='));

/* ---------- Thème F-90..F-92 ---------- */
function themeActuel() { return localStorage.getItem('duelo-theme') || 'system'; }
function appliqueTheme(t) {
  const root = document.documentElement;
  if (t === 'dark') root.setAttribute('data-theme', 'dark');
  else if (t === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  const b = document.getElementById('themebtn');
  if (b) b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#${t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor'}"/></svg>`;
}
function cycleTheme() {
  const ordre = ['system', 'light', 'dark'];
  const next = ordre[(ordre.indexOf(themeActuel()) + 1) % 3];
  localStorage.setItem('duelo-theme', next);
  appliqueTheme(next);
  if (logged()) api('/api/v1/me/theme', { method: 'PATCH', body: JSON.stringify({ theme: next }) }).catch(() => {});
}

/* ---------- Routeur ---------- */
const routes = {
  '/': home, '/classement': classement, '/defis': defis, '/tournois': tournois,
  '/tournoi': ficheTournoi, '/profil': profil, '/avatar': choixAvatar, '/lots': mesLots,
  '/orga': orga, '/orga-nouveau': orgaNouveau, '/admin-sante': sante, '/maintenance': maintenance, '/duel': duel, '/connexion': connexion, '/reglages': reglages,
  '/boutique': boutique, '/proposer': proposer, '/legal': legal, '/credits': credits,
};
function nav() {
  document.querySelectorAll('nav.bottom a').forEach((a) => a.getAttribute('href') === location.hash || (location.hash === '' && a.getAttribute('href') === '#/') ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}
async function router() {
  nav();
  const h = location.hash.replace('#', '') || '/';
  const [path] = h.split('?');
  (routes[path] ?? home)();
  refreshTop();
}
async function refreshTop() {
  const chip = document.getElementById('topmoi');
  if (!logged()) { chip.hidden = true; return; }
  try {
    const me = await api('/api/v1/me');
    chip.hidden = false;
    document.getElementById('pseudo').textContent = me.username + ' · N' + me.level;
    document.getElementById('pieces').textContent = me.coins + ' ◉';
    document.getElementById('topavatar').src = avatarUrl(me);
    document.getElementById('topavatar').alt = 'Ton avatar';
    if (me.theme_pref && me.theme_pref !== themeActuel() && !sessionStorage.getItem('theme-sync')) {
      sessionStorage.setItem('theme-sync', '1'); // le profil l'emporte une fois par session
      localStorage.setItem('duelo-theme', me.theme_pref); appliqueTheme(me.theme_pref);
    }
  } catch { chip.hidden = true; }
}
window.addEventListener('hashchange', router);
document.getElementById('themebtn').onclick = cycleTheme;

/* ---------- Écrans ---------- */
async function home() {
  let board = [];
  try { board = (await api('/api/v1/leaderboard?scope=weekly')).rows.slice(0, 3); } catch {}
  let orgaT = [];
  try { orgaT = (await api('/api/v1/tournaments?kind=organizer')).rows.slice(0, 2); } catch {}
  app.innerHTML = `
    <h1 class="sr">Duelo — duel de quiz en moins de 3 minutes</h1>
    ${mascotte('accueil', 'Salut ! Prêt pour un duel ?')}
    <div class="carte"><button class="btn principal" id="go">${icon('play')} Lancer un duel</button>
    <p class="muted" id="online"></p><button class="btn" id="ami">${icon('users')} Défier un ami</button></div>
    <div class="carte"><h2>Défi du jour</h2><p>Joue tes 10 questions du jour, une seule fois.</p><button class="btn secondaire" id="dqgo">Jouer le défi du jour</button></div>
    <div class="carte"><h2>Top de la semaine</h2><ol>${board.map((r) => `<li>${esc(r.username)} — ${num(r.pts)} XP</li>`).join('') || '<li>Aucun duel pour l’instant. Lance le premier.</li>'}</ol><a href="#/classement">Voir tout</a></div>
    <div class="carte"><h2>Tournoi du samedi 20:00</h2><p>Inscris-toi avant samedi.</p><a href="#/tournois">Voir les tournois</a></div>
    ${orgaT.map((t) => `<div class="carte"><span class="sticker violet">Tournoi d'organisateur</span><h3>${esc(t.name)}</h3><a href="#/tournoi?id=${num(t.id)}">Voir</a></div>`).join('')}`;
  const go = document.getElementById('go');
  go.classList.add('respire');
  go.onclick = () => location.hash = '#/duel';
  document.getElementById('dqgo').onclick = () => dailyRun();
  document.getElementById('ami').onclick = async () => { const p = await demande('Défier un ami', 'Pseudo de ton ami'); if (p) api('/api/v1/friend-challenges', { method: 'POST', body: JSON.stringify({ username: p, stake: 0 }) }).then(() => info('Défi envoyé.')).catch(async (e) => info('Oups', esc(e.message))); };
}

async function classement() {
  const scope = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('scope') ?? 'global';
  app.innerHTML = `<h1>Classement</h1><p><a href="#/classement?scope=global">Global</a> · <a href="#/classement?scope=weekly">Hebdo</a> · <a href="#/classement?scope=friends">Amis</a></p><div id="t"><div class="skel"></div></div>`;
  try {
    const d = await api('/api/v1/leaderboard?scope=' + scope);
    document.getElementById('t').innerHTML = `<table>${(d.rows ?? []).map((r, i) => `<tr><td>${i + 1}</td><td>${avatarImg(r, '')}<a href="#/profil?u=${encodeURIComponent(r.username)}">${esc(r.username)}</a></td><td class="rep">${num(r.elo ?? r.pts ?? r.ok)}</td></tr>`).join('') || '<tr><td>Aucun joueur classé. Joue 5 duels pour apparaître.</td></tr>'}</table>`;
  } catch (e) { document.getElementById('t').textContent = e.message; }
}

async function defis() {
  app.innerHTML = `<h1>Défis</h1><div id="d"><div class="skel"></div></div>`;
  try {
    const d = await api('/api/v1/challenges');
    const carte = (c) => `<div class="carte"><strong>${esc(c.label)}</strong> <span class="pill">${num(d.progress[c.code]?.progress)}/${num(c.goal)}</span> <button class="btn" data-c="${num(c.id)}">${icon('gift')} Réclamer</button></div>`;
    document.getElementById('d').innerHTML = `<h2>Aujourd’hui</h2>` + d.daily.map(carte).join('') + `<h2>Cette semaine</h2>` + d.weekly.map(carte).join('');
    document.querySelectorAll('[data-c]').forEach((b) => b.onclick = async () => {
      try { await api('/api/v1/challenges/' + b.dataset.c + '/claim', { method: 'POST' }); info('Récompense réclamée.'); } catch (e) { info('Oups', esc(e.message)); }
    });
  } catch { document.getElementById('d').textContent = 'Connecte-toi pour suivre tes défis.'; }
}

async function tournois() {
  const onglet = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('tab') ?? 'officiels';
  app.innerHTML = `<h1>Tournois</h1><p><a href="#/tournois?tab=officiels">Officiels</a> · <a href="#/tournois?tab=orga">Organisateurs</a> · <a href="#/tournois?tab=prive">Privé (code)</a></p><div id="t"><div class="skel"></div></div>`;
  const el = document.getElementById('t');
  if (onglet === 'prive') {
    el.innerHTML = `<div class="carte"><label class="fl" for="code">Code d’invitation (6 caractères)</label><input id="code" maxlength="6" autocomplete="off"><button class="btn secondaire" id="ok">Rejoindre</button></div>`;
    document.getElementById('ok').onclick = async () => {
      try { const t = await api('/api/v1/tournaments/by-code/' + encodeURIComponent(document.getElementById('code').value.trim())); location.hash = '#/tournoi?id=' + t.id; } catch (e) { info('Oups', esc(e.message)); }
    };
    return;
  }
  const d = await api('/api/v1/tournaments?kind=' + (onglet === 'orga' ? 'organizer' : 'official'));
  el.innerHTML = (d.rows ?? []).map((t) => `<div class="carte">${t.organizer_id ? '<span class="sticker violet">Organisateur</span> ' : ''}<strong>${esc(t.name)}</strong> <span class="pill">${num(t.size)} joueurs · ${esc(t.status)}</span><br><a href="#/tournoi?id=${num(t.id)}">Voir la fiche</a></div>`).join('') || '<div class="carte">Aucun tournoi pour l’instant.</div>';
}

async function ficheTournoi() {
  const id = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('id');
  const d = await api('/api/v1/tournaments/' + id);
  const t = d.tournament;
  const cover = t.cover_ref ? (t.cover_ref.startsWith('upload:') ? `/api/v1/cover/photo/${encodeURIComponent(t.cover_ref.slice(7))}` : `/assets/covers/${esc(t.cover_ref)}`) : null;
  const lots = (d.rewards ?? []).map((r) => `<span class="sticker soleil">${icon('gift')} ${esc(r.public_label)}</span>`).join(' ');
  const arbre = (d.matches ?? []).map((m) => `<tr><td>${esc(m.round)}</td><td>${esc(m.p1_name ?? '?')} — ${esc(m.p2_name ?? '?')}</td><td>${m.winner_id ? 'terminé' : esc(m.status)}</td></tr>`).join('');
  app.innerHTML = `<h1>${esc(t.name)}</h1>
    ${cover ? `<img class="couv" src="${cover}" alt="Couverture du tournoi" loading="lazy">` : ''}
    <div class="carte"><p>${esc(t.description ?? '')}</p><p>${lots || '<span class="muted">Pas de lots annoncés.</span>'}</p>
    <button class="btn secondaire" id="join">Rejoindre</button> <button class="btn" id="check">Pointer</button></div>
    <div class="carte"><h2>Arbre</h2><table>${arbre}</table></div>`;
  document.getElementById('join').onclick = () => api(`/api/v1/tournaments/${t.id}/join`, { method: 'POST' }).then(() => info('Inscrit.')).catch((e) => info('Oups', esc(e.message)));
  document.getElementById('check').onclick = () => api(`/api/v1/tournaments/${t.id}/checkin`, { method: 'POST' }).then(() => info('Pointé.')).catch((e) => info('Oups', esc(e.message)));
}

async function profil() {
  const u = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('u');
  try {
    const me = u ? await api('/api/v1/users/' + encodeURIComponent(u)) : await api('/api/v1/me');
    const badgesTxt = (me.badges ?? []).map((b) => esc(b.label ?? b.slug)).join(', ') || 'aucun';
    app.innerHTML = `<h1>${esc(me.username)}</h1>
      <div class="carte centre">${avatarImg(me)}<p>Niveau ${num(me.level)} · Elo <span class="rep">${num(me.elo)}</span> · ${esc(me.league?.label)}</p>
      <p>${num(me.wins)} victoires · Série ${num(me.streak_days)} j · ${num(me.coins)} pièces</p><p>Badges : ${badgesTxt}</p>
      ${u ? `<button class="btn" id="sig">Signaler cet avatar</button>` : `<a class="btn" href="#/avatar">${icon('camera')} Changer d’avatar</a> <a class="btn" href="#/lots">${icon('gift')} Mes lots</a> <a href="#/reglages">Réglages</a> · <a href="#/boutique">Boutique</a> · <a href="#/proposer">Proposer une question</a>`}</div>`;
    const sig = document.getElementById('sig');
    if (sig) sig.onclick = () => api(`/api/v1/avatars/${encodeURIComponent(me.username)}/report`, { method: 'POST', body: JSON.stringify({}) }).then(() => info('Signalé. Merci.')).catch((e) => info('Oups', esc(e.message)));
  } catch { location.hash = '#/connexion'; }
}

async function choixAvatar() {
  const filtre = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('f') ?? 'tous';
  const cats = ['tous', 'personnages', 'animaux', 'fantaisie', 'creatures'];
  const liste = AVATARS.filter((a) => filtre === 'tous' || a.cat === filtre);
  app.innerHTML = `<h1>Ton avatar</h1>
    <div class="filtres">${cats.map((c) => `<a class="pill" href="#/avatar?f=${c}">${c}</a>`).join('')}</div>
    <div class="grille-avatars">${liste.map((a) => `<button data-f="${a.f}" aria-pressed="false" aria-label="Choisir ${a.f}"><img src="/assets/avatars/${a.f}" alt="" loading="lazy"></button>`).join('')}</div>
    <div class="carte"><h2>Ta photo</h2><p class="muted">Ta photo sera visible par tous les joueurs. Évite d’y mettre des informations personnelles.</p>
    <input type="file" id="ph" accept="image/jpeg,image/png,image/webp" aria-label="Choisir une photo">
    <button class="btn secondaire" id="up">${icon('arrow-square-up')} Envoyer ma photo</button>
    <button class="btn" id="rm">Retirer ma photo</button></div>`;
  document.querySelectorAll('[data-f]').forEach((b) => b.onclick = async () => {
    await api('/api/v1/me/avatar', { method: 'PATCH', body: JSON.stringify({ ref: b.dataset.f }) });
    info('Avatar choisi.'); location.hash = '#/profil';
  });
  document.getElementById('up').onclick = async () => {
    const f = document.getElementById('ph').files[0];
    if (!f) { info('Choisis un fichier.'); return; }
    const fd = new FormData(); fd.append('photo', await reduirePhoto(f));
    const r = await fetch('/api/v1/me/avatar/upload', { method: 'POST', body: fd });
    if (!r.ok) { info('Oups', esc((await r.json()).error)); return; }
    info('Photo envoyée.'); location.hash = '#/profil';
  };
  document.getElementById('rm').onclick = async () => { if (await confirme('Retirer ma photo ?', 'Tu reviendras à un avatar du catalogue.')) api('/api/v1/me/avatar/upload', { method: 'DELETE' }).then(() => info('Photo retirée.')).catch((e) => info('Oups', esc(e.message))); };
}

async function mesLots() {
  app.innerHTML = `<h1>Mes lots</h1><div id="l"><div class="skel"></div></div>`;
  try {
    const d = await api('/api/v1/me/rewards');
    document.getElementById('l').innerHTML = (d.rows ?? []).map((c) => `<div class="carte"><span class="sticker soleil">${esc(c.public_label)}</span>
      <p class="muted">${esc(c.tournament_name ?? '')} · ${c.expires_at ? 'valable jusqu’au ' + esc(new Date(c.expires_at).toLocaleDateString()) : 'sans expiration'}</p>
      <p>${esc(c.instructions ?? '')}</p>
      ${c.warning ? `<p><strong>Attention :</strong> ${esc(c.warning)}</p>` : ''}
      <div data-claim="${num(c.id)}">${c.status === 'revealed' ? '<span class="pill">révélé</span>' : `<button class="btn principal" data-rev="${num(c.id)}">Révéler mon lot</button>`}
      ${c.kind === 'fichier' ? `<button class="btn" data-dl="${num(c.id)}">${icon('arrow-square-down')} Télécharger</button>` : ''}
      <button class="btn" data-rep="${num(c.id)}">Ce lot ne fonctionne pas</button></div></div>`).join('') || '<div class="carte">Aucun lot pour l’instant. Gagne un tournoi !</div>';
    document.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
      const r = await api(`/api/v1/me/rewards/${b.dataset.rev}/reveal`, { method: 'POST' });
      const zone = b.closest(`[data-claim="${b.dataset.rev}"]`);
      zone.innerHTML = `<div class="carte"><strong>Ton lot :</strong> <code>${esc(r.content)}</code> <button class="btn" id="cp">Copier</button></div>`;
      document.getElementById('cp').onclick = () => navigator.clipboard?.writeText(r.content).then(() => info('Copié.'));
      say('Lot révélé.');
    });
    document.querySelectorAll('[data-dl]').forEach((b) => b.onclick = async () => {
      const card = b.closest('.carte');
      const warn = card && card.textContent.includes('Attention');
      if (warn && !(await confirme('Télécharger quand même ?', 'Ce fichier n’a pas été scanné par antivirus.'))) return;
      location.href = `/api/v1/me/rewards/${b.dataset.dl}/download`;
    });
    document.querySelectorAll('[data-rep]').forEach((b) => b.onclick = () => api(`/api/v1/me/rewards/${b.dataset.rep}/report`, { method: 'POST', body: JSON.stringify({ reason: 'ne fonctionne pas' }) }).then(() => info('Signalé à l’organisateur.')).catch((e) => info('Oups', esc(e.message))));
  } catch (e) { document.getElementById('l').textContent = e.message; }
}

/* ---------- Assistant de création : Infos, Règles, Lots, Aperçu (F-130) ---------- */
const ETAPES = ['Infos', 'Règles', 'Lots', 'Aperçu'];
async function orgaNouveau() {
  const q = new URLSearchParams((location.hash.split('?')[1] ?? ''));
  const etape = Math.min(4, Math.max(1, num(q.get('etape')) || 1));
  let tid = num(q.get('id'));
  try {
    if (!tid) {
      // Reprend le brouillon local ou crée un brouillon serveur (sauvegarde auto).
      tid = num(localStorage.getItem('duelo-brouillon'));
      if (tid) {
        try { await api('/api/v1/tournaments/' + tid); } catch { tid = 0; }
      }
      if (!tid) {
        const r = await api('/api/v1/organizer/tournaments/draft', { method: 'POST' });
        tid = r.id;
        localStorage.setItem('duelo-brouillon', String(tid));
      }
      location.hash = `#/orga-nouveau?etape=1&id=${tid}`;
      return;
    }
    const d = await api('/api/v1/tournaments/' + tid);
    const t = d.tournament;
    const barre = `<div class="onglets" role="tablist">${ETAPES.map((e, i) => `<button role="tab" aria-selected="${etape === i + 1}" data-e="${i + 1}">${i + 1}. ${e}</button>`).join('')}</div><p class="muted" id="save">Brouillon enregistré.</p>`;
    if (etape === 1) {
      const covers = ['couv-1.svg', 'couv-2.svg', 'couv-3.svg', 'couv-4.svg', 'couv-5.svg', 'couv-6.svg'];
      app.innerHTML = `<h1>Nouveau tournoi</h1>${barre}<div class="carte">
        <label class="fl" for="w-nom">Nom (60 max)</label><input id="w-nom" maxlength="60" value="${esc(t.name === 'Nouveau tournoi' ? '' : t.name)}">
        <label class="fl" for="w-desc">Description (500 max)</label><textarea id="w-desc" rows="3" maxlength="500">${esc(t.description ?? '')}</textarea>
        <label class="fl" for="w-taille">Joueurs</label><select id="w-taille">${[8, 16, 32].map((s) => `<option value="${s}"${t.size === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <label class="fl" for="w-date">Début</label><input id="w-date" type="datetime-local" value="${toLocal(t.starts_at)}">
        <label class="fl" for="w-vis">Visibilité</label><select id="w-vis"><option value="public"${t.visibility === 'public' ? ' selected' : ''}>Public</option><option value="private"${t.visibility === 'private' ? ' selected' : ''}>Privé (code)</option></select>
        <h3>Couverture</h3><div class="grille-avatars">${covers.map((c) => `<button data-cover="${c}" aria-pressed="${t.cover_ref === c}"><img src="/assets/covers/${c}" alt="" loading="lazy"></button>`).join('')}</div>
        <label class="fl" for="w-ph">Ou ta photo (JPEG/PNG/WebP, 3 Mo)</label><input type="file" id="w-ph" accept="image/jpeg,image/png,image/webp">
        <div class="rang" style="display:flex;gap:10px;margin-top:12px"><button class="btn principal" id="w-next">Continuer → Règles</button></div></div>`;
      const sauve = debounce(async () => {
        const patch = {
          name: document.getElementById('w-nom').value.trim() || 'Nouveau tournoi',
          description: document.getElementById('w-desc').value.trim(),
          size: num(document.getElementById('w-taille').value),
          startsAt: new Date(document.getElementById('w-date').value || Date.now() + 7 * 864e5).getTime(),
          visibility: document.getElementById('w-vis').value,
        };
        await api(`/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch((e) => { document.getElementById('save').textContent = e.message; });
        document.getElementById('save').textContent = 'Brouillon enregistré ✓ ' + new Date().toLocaleTimeString();
      }, 800);
      ['w-nom', 'w-desc', 'w-taille', 'w-date', 'w-vis'].forEach((id) => document.getElementById(id).addEventListener('input', sauve));
      document.querySelectorAll('[data-cover]').forEach((b) => b.onclick = async () => {
        await api(`/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', body: JSON.stringify({ cover: b.dataset.cover }) });
        document.querySelectorAll('[data-cover]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
      });
      document.getElementById('w-ph').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const fd = new FormData(); fd.append('photo', await reduirePhoto(f));
        const r = await fetch(`/api/v1/organizer/tournaments/${tid}/cover`, { method: 'POST', body: fd });
        if (!r.ok) { info('Oups', esc((await r.json()).error)); return; }
        info('Couverture envoyée.');
      };
      document.getElementById('w-next').onclick = async () => { await sauve.now(); location.hash = `#/orga-nouveau?etape=2&id=${tid}`; };
    }
    if (etape === 2) {
      const rules = JSON.parse(t.rules_json ?? '{}');
      const cats = ['histoire', 'geographie', 'sciences', 'cinema-series', 'musique', 'sport', 'jeux-video', 'culture-generale'];
      app.innerHTML = `<h1>Règles du jeu</h1>${barre}<div class="carte">
        <h3>Catégories (vide = toutes)</h3><div class="filtres">${cats.map((c) => `<label class="pill"><input type="checkbox" data-cat="${c}"${(rules.categories ?? []).includes(c) ? ' checked' : ''}> ${c}</label>`).join('')}</div>
        <label class="fl" for="w-diff">Difficulté</label><select id="w-diff">${['mixte', 'facile', 'moyen', 'difficile'].map((x) => `<option${(rules.difficulty ?? 'mixte') === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
        <label class="fl" for="w-fin">Finale</label><select id="w-fin"><option value="1"${(rules.finalBestOf ?? 1) === 1 ? ' selected' : ''}>1 duel</option><option value="3"${rules.finalBestOf === 3 ? ' selected' : ''}>Meilleur des 3</option></select>
        <label class="fl" for="w-niv">Niveau minimum (1 = tous)</label><input id="w-niv" type="number" min="1" max="100" value="${num(rules.minLevel) || 1}">
        <label class="fl" for="w-inv">Invités (un pseudo par ligne, vide = ouvert)</label><textarea id="w-inv" rows="3">${esc((rules.guests ?? []).join('\n'))}</textarea>
        <label class="ligne-check"><input class="grosse" type="checkbox" id="w-man"${t.manual_release ? ' checked' : ''}> Libération manuelle des lots</label>
        <label class="ligne-check"><input class="grosse" type="checkbox" id="w-acc"> J’accepte les règles d’organisation (gratuit, lots légaux, seul responsable)</label>
        <div class="rang" style="display:flex;gap:10px;margin-top:12px"><button class="btn principal" id="w-next">Continuer → Lots</button></div></div>`;
      document.getElementById('w-next').onclick = async () => {
        if (!document.getElementById('w-acc').checked && !rulesAccepted(tid)) { info('Coche la case des règles d’organisation pour continuer.'); return; }
        const rules2 = {
          categories: [...document.querySelectorAll('[data-cat]:checked')].map((x) => x.dataset.cat),
          difficulty: document.getElementById('w-diff').value,
          finalBestOf: num(document.getElementById('w-fin').value),
          minLevel: num(document.getElementById('w-niv').value) || undefined,
          guests: document.getElementById('w-inv').value.split('\n').map((s) => s.trim()).filter(Boolean),
        };
        await api(`/api/v1/organizer/tournaments/${tid}`, { method: 'PATCH', body: JSON.stringify({ rules: rules2, manualRelease: document.getElementById('w-man').checked }) });
        if (document.getElementById('w-acc').checked) {
          await api(`/api/v1/organizer/tournaments/${tid}/terms`, { method: 'POST' }).catch(() => {});
          localStorage.setItem('duelo-terms-' + tid, '1');
        }
        location.hash = `#/orga-nouveau?etape=3&id=${tid}`;
      };
    }
    if (etape === 3) {
      const lots = d.rewards ?? [];
      app.innerHTML = `<h1>Lots</h1>${barre}
        ${lots.map((l) => `<div class="carte"><span class="sticker soleil">${esc(l.public_label)}</span> <span class="pill">${esc(l.kind)} · rangs ${num(l.rank_from)}-${num(l.rank_to)}</span></div>`).join('') || '<div class="carte">Aucun lot. Les lots donnent envie de participer.</div>'}
        <div class="carte"><h3>Ajouter un lot</h3>
        <label class="fl" for="l-label">Libellé public</label><input id="l-label" maxlength="80">
        <label class="fl" for="l-kind">Type</label><select id="l-kind"><option value="texte">Message</option><option value="secret">Code secret</option><option value="lien">Lien</option><option value="lot_de_codes">Liste de codes (un par ligne)</option><option value="fichier">Fichier</option></select>
        <label class="fl" for="l-r1">Rangs (de)</label><input id="l-r1" type="number" min="1" max="32" value="1">
        <label class="fl" for="l-r2">Rangs (à)</label><input id="l-r2" type="number" min="1" max="32" value="1">
        <label class="fl" for="l-cont">Contenu ou codes</label><textarea id="l-cont" rows="3"></textarea>
        <button class="btn secondaire" id="l-add">Ajouter le lot</button>
        <div class="rang" style="display:flex;gap:10px;margin-top:12px"><button class="btn principal" id="w-next">Continuer → Aperçu</button></div></div>`;
      document.getElementById('l-add').onclick = async () => {
        const kind = document.getElementById('l-kind').value;
        const body = { rankFrom: num(document.getElementById('l-r1').value) || 1, rankTo: num(document.getElementById('l-r2').value) || 1, publicLabel: document.getElementById('l-label').value.trim(), kind };
        const txt = document.getElementById('l-cont').value;
        if (kind === 'lot_de_codes') body.codes = txt.split('\n').map((s) => s.trim()).filter(Boolean);
        else body.content = txt;
        try { await api(`/api/v1/organizer/tournaments/${tid}/rewards`, { method: 'POST', body: JSON.stringify(body) }); router(); }
        catch (e) { info('Oups', esc(e.message)); }
      };
      document.getElementById('w-next').onclick = () => location.hash = `#/orga-nouveau?etape=4&id=${tid}`;
    }
    if (etape === 4) {
      app.innerHTML = `<h1>Aperçu et publication</h1>${barre}<div class="carte">
        <h2>${esc(t.name)}</h2><p>${esc(t.description ?? '')}</p>
        <p class="muted">${num(t.size)} joueurs · ${esc(t.visibility)} · début ${esc(new Date(t.starts_at).toLocaleString())}</p>
        <p>${(d.rewards ?? []).map((l) => `<span class="sticker soleil">${esc(l.public_label)}</span>`).join(' ') || 'Aucun lot.'}</p>
        <button class="btn principal" id="pub">Publier le tournoi</button>
        <button class="btn" id="apercu">Voir la fiche publique</button></div>`;
      document.getElementById('pub').onclick = async () => {
        try {
          const r = await api(`/api/v1/organizer/tournaments/${tid}/publish`, { method: 'POST' });
          localStorage.removeItem('duelo-brouillon');
          info(r.status === 'pending' ? 'Envoyé en validation admin.' : 'Tournoi publié.');
          location.hash = '#/orga';
        } catch (e) { info('Publication bloquée', esc(e.message)); }
      };
      document.getElementById('apercu').onclick = () => location.hash = '#/tournoi?id=' + tid;
    }
    document.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => location.hash = `#/orga-nouveau?etape=${b.dataset.e}&id=${tid}`);
  } catch (e) {
    app.innerHTML = `<div class="carte"><p>${esc(e.message)}</p></div>`;
  }
}
function toLocal(ms) {
  const d = new Date(num(ms) || Date.now() + 7 * 864e5);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function debounce(fn, ms) {
  let h = null;
  const f = (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  f.now = () => { clearTimeout(h); return fn(); };
  return f;
}
function rulesAccepted(tid) { return localStorage.getItem('duelo-terms-' + tid) === '1'; }

async function orga() {
  app.innerHTML = `<h1>Espace organisateur</h1><div id="o"><div class="skel"></div></div>`;
  try {
    const d = await api('/api/v1/organizer/tournaments');
    document.getElementById('o').innerHTML = `<a class="btn principal" href="#/orga-nouveau">${icon('plus')} Créer un tournoi</a>` +
      (d.rows ?? []).map((t) => `<div class="carte"><strong>${esc(t.name)}</strong> <span class="pill">${esc(t.status)} · ${num(t.inscrits)} inscrits</span><br><a href="#/tournoi?id=${num(t.id)}">Gérer</a> <button class="btn" data-dup="${num(t.id)}">Dupliquer</button> <button class="btn" data-csv="${num(t.id)}">Exporter CSV</button></div>`).join('');
    document.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => api(`/api/v1/organizer/tournaments/${b.dataset.dup}/duplicate`, { method: 'POST' }).then(() => router()).catch((e) => info('Oups', esc(e.message))));
    document.querySelectorAll('[data-csv]').forEach((b) => b.onclick = () => { location.href = `/api/v1/organizer/tournaments/${b.dataset.csv}/export.csv`; });
  } catch (e) { document.getElementById('o').innerHTML = `<div class="carte"><p>${esc(e.message)}</p><p>Seuls les organisateurs autorisés par un admin voient cet espace.</p></div>`; }
}

/* ---------- Connexion / inscription (onglets, §1) ---------- */
async function connexion() {
  const tab = new URLSearchParams((location.hash.split('?')[1] ?? '')).get('tab') ?? 'login';
  app.innerHTML = `
  <h1 class="sr">Connexion ou création de compte</h1>
  <div class="carte auth-wrap">
    <div class="auth-masc">${mascotte('accueil', tab === 'login' ? 'Rebonjour, champion !' : 'Bienvenue dans l’arène !')}</div>
    <div class="auth-form">
    <div class="onglets" role="tablist"><button role="tab" aria-selected="${tab === 'login'}" data-t="login">Connexion</button><button role="tab" aria-selected="${tab === 'register'}" data-t="register">Créer un compte</button></div>
    <form id="f">
      <label class="fl" for="pseudo">Pseudo</label>
      <input id="pseudo" name="username" required minlength="3" maxlength="16" autocomplete="username" autocapitalize="none">
      <label class="fl" for="mdp">Mot de passe</label>
      <div class="champ-mdp"><input id="mdp" type="password" name="password" required ${tab === 'register' ? 'minlength="10"' : ''} autocomplete="${tab === 'login' ? 'current-password' : 'new-password'}">
      <button type="button" id="voir" aria-label="Afficher le mot de passe">${icon('eye')}</button></div>
      ${tab === 'register' ? `<p class="regle-mdp">10 caractères minimum. Un mot de passe long et unique.</p>
      <label class="fl" for="email">E-mail (facultatif, pour récupérer ton compte)</label>
      <input id="email" type="email" name="email" autocomplete="email" placeholder="toi@exemple.fr">
      <label class="ligne-check"><input class="grosse" type="checkbox" name="ageOk" required> J’ai 13 ans ou plus</label>` : ''}
      <button class="btn principal mt">${tab === 'login' ? 'Se connecter' : 'Créer mon compte'}</button>
    </form>
    <p><button class="btn" id="guest">Essayer sans compte</button></p>
    </div></div>`;
  document.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => location.hash = '#/connexion?tab=' + b.dataset.t);
  document.getElementById('voir').onclick = (e) => { const i = document.getElementById('mdp'); i.type = i.type === 'password' ? 'text' : 'password'; e.currentTarget.setAttribute('aria-label', i.type === 'password' ? 'Afficher le mot de passe' : 'Masquer le mot de passe'); };
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { username: String(fd.get('username')).trim(), password: String(fd.get('password')) };
    try {
      if (tab === 'login') {
        const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).error);
      } else {
        const email = String(fd.get('email') ?? '').trim();
        const r = await fetch('/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, email, ageOk: true }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (j.recoveryCodes) modale({ titre: 'Tes codes de secours', texte: `<p>Note-les, ils ne seront plus affichés :</p><p><strong>${esc(j.recoveryCodes.join(' '))}</strong></p>` });
      }
      location.hash = '#/';
    } catch (err) { info('Oups', esc(err.message)); }
  };
  document.getElementById('guest').onclick = async () => { await fetch('/api/v1/auth/guest', { method: 'POST' }); location.hash = '#/'; };
}

async function reglages() {
  const me = await api('/api/v1/me').catch(() => null);
  app.innerHTML = `<h1>Réglages</h1>
  <div class="carte"><h2>Thème</h2><div class="onglets"><button data-th="system">Système</button><button data-th="light">Clair</button><button data-th="dark">Sombre</button></div>
  <label class="ligne-check"><input class="grosse" type="checkbox" id="rm" ${me?.reduced_motion ? 'checked' : ''}> Animations réduites</label></div>
  <div class="carte"><button class="btn" id="chest">${icon('gift')} Réclamer le coffre</button><button class="btn" id="exp">Exporter mes données</button><button class="btn" id="out">Se déconnecter partout</button><button class="btn" id="del">Supprimer mon compte</button></div>
  <div class="carte"><a href="#/legal">Confidentialité · Conduite · Mentions</a> · <a href="#/credits">Crédits</a></div>`;
  document.querySelectorAll('[data-th]').forEach((b) => b.onclick = () => {
    localStorage.setItem('duelo-theme', b.dataset.th); appliqueTheme(b.dataset.th);
    if (logged()) api('/api/v1/me/theme', { method: 'PATCH', body: JSON.stringify({ theme: b.dataset.th }) }).catch(() => {});
  });
  document.getElementById('rm').onchange = async (e) => {
    const v = e.target.checked;
    localStorage.setItem('duelo-motion', v ? 'reduced' : 'full');
    document.documentElement.setAttribute('data-motion', v ? 'reduced' : 'full');
    if (logged()) await api('/api/v1/me', { method: 'PATCH', body: JSON.stringify({ reduced_motion: v }) }).catch(() => {});
  };
  document.getElementById('chest').onclick = () => api('/api/v1/chest/claim', { method: 'POST' }).then((r) => info(`Coffre ouvert : +${num(r.coins)} pièces (série ${num(r.streak)})`, '', 'coffre')).catch((e) => info('Oups', esc(e.message)));
  document.getElementById('exp').onclick = async () => info('Tes données', esc(JSON.stringify(await api('/api/v1/me/export')).slice(0, 200) + '…'));
  document.getElementById('out').onclick = async () => { if (await confirme('Se déconnecter partout ?', 'Toutes tes sessions seront fermées.')) api('/api/v1/auth/logout-all', { method: 'POST' }).then(() => location.hash = '#/connexion'); };
  document.getElementById('del').onclick = async () => { if (await confirme('Supprimer ton compte ?', 'Tes données seront anonymisées. Irréversible !', 'defaite')) { await api('/api/v1/me', { method: 'DELETE' }); location.hash = '#/connexion'; } };
}

async function boutique() {
  const d = await api('/api/v1/shop');
  app.innerHTML = `<h1>Boutique</h1><p class="muted">Cosmétiques en pièces uniquement. Aucun avantage de jeu.</p>` + d.rows.map((c) => `<div class="carte"><strong>${esc(c.label)}</strong> <span class="pill">${num(c.price)} ◉</span> <button class="btn" data-s="${esc(c.slug)}">Acheter</button></div>`).join('');
  document.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => api('/api/v1/shop/buy', { method: 'POST', body: JSON.stringify({ slug: b.dataset.s }) }).then(() => info('Acheté.')).catch((e) => info('Oups', esc(e.message))));
}

async function proposer() {
  app.innerHTML = `<h1>Proposer une question</h1><form id="f"><label class="fl">Énoncé<input name="text" required minlength="12"></label><label class="fl">4 réponses séparées par ;<input name="a" required></label><label class="fl">Index de la bonne (0-3)<input name="c" value="0"></label><label class="fl">Catégorie<input name="cat" value="culture-generale"></label><label class="fl">Source<input name="s" required></label><button class="btn principal">Proposer</button></form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const answers = String(fd.get('a')).split(';');
    try { await api('/api/v1/questions', { method: 'POST', body: JSON.stringify({ text: fd.get('text'), answers, correct: num(fd.get('c')), category: fd.get('cat'), source: fd.get('s') }) }); info('Envoyée en validation.'); } catch (er) { info('Oups', esc(er.message)); }
  };
}

function legal() {
  app.innerHTML = `<h1>Pages légales</h1><div class="carte"><h2>Confidentialité</h2><p>Pseudo et mot de passe haché uniquement. E-mail facultatif. Aucun pistage, aucune pub. Export et suppression dans Réglages.</p><p><strong>Photos :</strong> ta photo d’avatar est visible par tous les joueurs. Elle est ré-encodée (métadonnées supprimées) et effacée du disque à sa suppression ou à celle du compte. Les photos en attente de validation restent invisibles.</p><p><strong>Lots :</strong> les contenus sensibles sont chiffrés. Chaque révélation et chaque téléchargement sont journalisés (qui, quand, quel lot) pour prouver la remise ; ces journaux ne contiennent jamais le contenu du lot. La suppression du compte anonymise le pseudo (« Joueur supprimé ») et efface les photos, mais conserve les lignes d’historique anonymisées et les journaux de remise (preuve pour les organisateurs).</p><h2>Règles de conduite</h2><p>Joue loyalement. Aucun outil d’aide, un seul compte, respect des autres via les emotes uniquement.</p><h2>Règles d’organisation</h2><p>Les tournois restent gratuits à l’entrée : aucune mise d’argent des participants. La plateforme ne gère ni paiement ni argent réel. L’organisateur est seul responsable de la légalité et de la livraison de ses lots ; l’exploitant doit vérifier la réglementation locale applicable aux concours et aux lots.</p><h2>Mentions</h2><p>Duelo, projet de démonstration. Contact via l’exploitant.</p></div>`;
}

function maintenance() {
  app.innerHTML = `<h1 class="sr">Maintenance</h1>${mascotte('defaite', 'On revient bientôt !')}
    <div class="carte centre"><h2>On revient bientôt</h2><p>Petite pause technique. Tes duels en cours se terminent normalement.</p><a class="btn secondaire" href="#/">Réessayer</a></div>`;
}

async function sante() {
  app.innerHTML = `<h1>Santé du serveur</h1><div id="s"><div class="skel"></div></div>`;
  try {
    const h = await api('/api/v1/admin/health');
    const mo = (b) => b == null ? '?' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' Mo' : Math.round(b / 1024) + ' Ko';
    const disqTxt = h.disque ? num(h.disque.libreMo) + ' / ' + num(h.disque.totalMo) + ' Mo' : '?';
    const avTxt = mo(num(h.uploads.avatars.bytes)) + (h.uploads.avatars.tronque ? ' (tronqué)' : '');
    const rwTxt = mo(num(h.uploads.rewards.bytes)) + (h.uploads.rewards.tronque ? ' (tronqué)' : '');
    const sauveTxt = h.derniereSauvegarde ? esc(h.derniereSauvegarde.fichier) + ' · ' + esc(h.derniereSauvegarde.date) : 'aucune';
    document.getElementById('s').innerHTML = `<div class="carte"><table>
      <tr><td>RAM processus</td><td class="rep">${num(h.ramMo)} Mo (heap ${num(h.heapMo)} Mo)</td></tr>
      <tr><td>CPU depuis démarrage</td><td class="rep">${esc(String(h.cpuPctDepuisDemarrage))} % d’un cœur</td></tr>
      <tr><td>En ligne (5 min)</td><td class="rep">${num(h.enLigne5min)}</td></tr>
      <tr><td>Duels actifs</td><td class="rep">${num(h.duelsActifs)}</td></tr>
      <tr><td>Disque libre</td><td class="rep">${disqTxt}</td></tr>
      <tr><td>Uploads avatars</td><td class="rep">${avTxt}</td></tr>
      <tr><td>Uploads lots</td><td class="rep">${rwTxt}</td></tr>
      <tr><td>Dernière sauvegarde</td><td>${sauveTxt}</td></tr>
      </table></div>`;
  } catch (e) { document.getElementById('s').innerHTML = `<div class="carte"><p>${esc(e.message)}</p></div>`; }
}

function credits() {  app.innerHTML = `<h1>Crédits</h1><div class="carte">
  <h2>Polices (SIL OFL 1.1)</h2><p>Lilita One · Nunito — Google Fonts, fichiers auto-hébergés, sous-ensemble latin.</p>
  <h2>Mascotte et créatures (CC BY 4.0)</h2><p>« Fun Emoji » par Davis Uche, via DiceBear — <a href="https://www.dicebear.com/styles/fun-emoji/">dicebear.com/styles/fun-emoji</a> — <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Modifications : optimisation et nettoyage (svgo), redimensionnement, aucune retouche graphique.</p>
  <h2>Avatars personnages (CC BY 4.0)</h2><p>« Adventurer » par Lisa Wischofsky (<a href="https://www.dicebear.com/styles/adventurer/">dicebear</a>) · « Personas » par Draftbit (<a href="https://www.dicebear.com/styles/personas/">dicebear</a>) — <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Modifications : nettoyage svgo uniquement.</p>
  <h2>Avatars animaux (CC BY 4.0)</h2><p>Twemoji par Twitter, Inc. — <a href="https://github.com/twitter/twemoji">github.com/twitter/twemoji</a> — graphismes <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Modifications : nettoyage svgo uniquement.</p>
  <h2>Avatars et couvertures (CC0 1.0, domaine public)</h2><p>« Notionists » par Zoish · « Open Peeps » par Pablo Stanley · « Lorelei » par Lisa Wischofsky, via DiceBear. Modifications : nettoyage svgo uniquement.</p>
  <h2>Icônes (MIT)</h2><p>Phosphor Icons, © 2023 Phosphor Icons (<a href="https://github.com/phosphor-icons/core">dépôt</a>). Modifications : assemblage en sprite, nettoyage svgo.</p>
  <p>Détail complet : docs/LICENCES.md</p></div>`;
}

async function dailyRun() {
  try {
    const s = await api('/api/v1/daily-run/start', { method: 'POST' });
    app.innerHTML = `<h1>Défi du jour</h1>` + s.questions.map((q, i) => `<div class="carte"><p><strong>${i + 1}. ${esc(q.text)}</strong></p>${q.answers.map((a, j) => `<button class="btn" data-q="${i}" data-a="${j}">${esc(a)}</button>`).join('')}</div>`).join('') + `<button class="btn principal" id="send">Valider</button>`;
    const picks = {};
    document.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { picks[b.dataset.q] = num(b.dataset.a); b.classList.add('valide'); });
    document.getElementById('send').onclick = async () => {
      const r = await api('/api/v1/daily-run/answer', { method: 'POST', body: JSON.stringify({ answers: s.questions.map((_, i) => picks[i] ?? 0), totalTimeMs: 60000 }) });
      info('Défi terminé', `Score : ${num(r.score)}`);
    };
  } catch (e) { info('Oups', esc(e.message)); }
}

/* ---------- Duel : corde de bras de fer + mascotte ---------- */
async function duel() {
  app.innerHTML = `<h1>Duel</h1><div class="carte"><p id="st">Recherche d’un adversaire…</p>
  <div class="tension" role="img" aria-label="Écart de score"><div class="moi" id="tm"></div>
  <span class="bout g"><img id="avG" alt="Ton avatar"></span><span class="bout d"><img id="avD" alt="Avatar adverse"></span></div>
  <div id="masczone"></div><div id="q"></div>
  <button class="btn" id="leave">Abandonner (confirmation)</button></div>`;
  const ws = live.connect({
    onMsg(m) {
      if (m.t === 'queue.joined') document.getElementById('st').textContent = 'En file… (fantôme proposé après 20 s)';
      if (m.t === 'match.found') {
        document.getElementById('st').textContent = `Adversaire : ${m.opponent.name} — c’est parti !`; say('Duel trouvé contre ' + m.opponent.name);
        document.getElementById('avD').src = m.opponent.avatarUrl ?? '/assets/avatars/personnage-a1.svg';
        if (logged()) api('/api/v1/me').then((me) => { document.getElementById('avG').src = avatarUrl(me); }).catch(() => {});
      }
      if (m.t === 'duel.countdown') document.getElementById('st').textContent = 'Face-à-face… 3, 2, 1 !';
      if (m.t === 'question.show') {
        say(`Question ${num(m.round)} sur 10. ${m.text}`);
        const dbl = m.doubled ? ' · doublée' : '';
        document.getElementById('q').innerHTML = `<p><strong>${esc(m.text)}</strong> <span class="pill">${num(m.round)}/10${dbl}</span></p><div class="timer"><i id="tb"></i></div>` + m.answers.map((a, i) => `<button class="btn rep" data-i="${i}">${i + 1}. ${esc(a)}</button>`).join('');
        const t0 = Date.now(), total = m.deadline - Date.now();
        const iv = setInterval(() => { const el = document.getElementById('tb'); if (!el) return clearInterval(iv); el.style.width = Math.max(0, 100 * (1 - (Date.now() - t0) / total)) + '%'; }, 100);
        document.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
          live.send({ t: 'answer', duelId: m.duelId, round: m.round, choice: num(b.dataset.i) });
          document.getElementById('st').textContent = 'Réponse envoyée. En attente…';
        });
      }
      if (m.t === 'question.reveal') {
        const pct = 50 + Math.max(-50, Math.min(50, (m.scores.you - m.scores.opp) / 20));
        document.getElementById('tm').style.width = pct + '%';
        document.getElementById('st').textContent = `+${num(m.yours.points)} pour toi, +${num(m.theirs.points)} pour l’adversaire. (${num(m.scores.you)} – ${num(m.scores.opp)})`;
        const humeur = m.yours.correct ? 'bonne' : 'mauvaise';
        document.getElementById('masczone').innerHTML = mascotte(humeur, m.yours.correct ? 'Bravo, ça c’est joué !' : 'Raté… la prochaine !', true);
        const im = document.querySelector('#masczone img'); if (im) { im.classList.add(m.yours.correct ? 'gonfle' : 'faux'); }
        say(m.yours.correct ? 'Bonne réponse.' : 'Mauvaise réponse. Bonne réponse : ' + m.correctText);
      }
      if (m.t === 'duel.end') {
        const gagne = m.winner != null;
        const titre = m.forfeit ? 'Forfait' : (gagne ? 'Victoire !' : 'Égalité');
        document.getElementById('masczone').innerHTML = mascotte(gagne ? 'victoire' : 'defaite', gagne ? 'Victoire ! Tu brilles !' : 'Belle bataille !', false);
        if (gagne) confetti();
        document.getElementById('q').innerHTML = `<div class="bandeau-victoire">${titre}</div><p class="rep">${num(m.scores.you)} – ${num(m.scores.opp)}</p><button class="btn principal" onclick="location.hash='#/'">Nouveau duel</button>`;
      }
    },
  });
  live.send({ t: 'queue.join', mode: 'ranked' });
  document.getElementById('leave').onclick = async () => { if (await confirme('Abandonner ce duel ?', 'Ton adversaire gagnera par forfait.', 'mauvaise')) live.send({ t: 'queue.leave' }); };
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced') return;
  const c = document.createElement('div');
  c.className = 'confetti'; c.setAttribute('aria-hidden', 'true');
  const couleurs = ['#FFC83D', '#3FB8FF', '#2FD08A', '#FF86C1', '#8A63FF'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = couleurs[i % couleurs.length];
    p.style.animationDelay = (Math.random() * 0.8) + 's';
    c.appendChild(p);
  }
  document.body.appendChild(c);
  setTimeout(() => c.remove(), 3400);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(x) { return Number(x ?? 0); }

/* Photo : redimensionnée côté navigateur (512 px max, WebP/JPEG) avant envoi,
   pour ne jamais faire traiter une image géante au serveur. Le serveur revérifie tout. */
async function reduirePhoto(file) {
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * ratio)), h = Math.max(1, Math.round(bmp.height * ratio));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const webp = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.85));
  if (webp) return new File([webp], 'photo.webp', { type: 'image/webp' });
  const jpg = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
  return new File([jpg], 'photo.jpg', { type: 'image/jpeg' });
}

/* Popups cartoon (jamais de alert/confirm/prompt natifs) : carte modale,
   focus sur le premier bouton, Échap = annuler, clic dehors = annuler. */
function modale({ titre, texte = '', boutons = [{ id: 'ok', label: 'OK', classe: 'principal' }], champ = null, humeur = null }) {
  return new Promise((resolve) => {
    const voile = document.createElement('div');
    voile.className = 'surcouche';
    voile.innerHTML = `<div class="modale" role="dialog" aria-modal="true" aria-label="${esc(titre)}">${humeur ? `<div class="tete"><img src="/assets/mascotte/mascotte-${humeur}.svg" alt="Mascotte Duelo"><h2>${esc(titre)}</h2></div>` : `<h2>${esc(titre)}</h2>`}${texte ? `<p>${texte}</p>` : ''}${champ ? `<label class="fl" for="m-champ">${esc(champ.label)}</label><input id="m-champ" value="${esc(champ.valeur ?? '')}" placeholder="${esc(champ.exemple ?? '')}" autocomplete="off">` : ''}<div class="rang">${boutons.map((b) => `<button class="btn ${b.classe ?? ''}" data-b="${b.id}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const fini = (valeur) => { voile.remove(); document.removeEventListener('keydown', echap); resolve(valeur); };
    const echap = (e) => { if (e.key === 'Escape') fini({ bouton: null, valeur: null }); };
    document.addEventListener('keydown', echap);
    voile.addEventListener('click', (e) => { if (e.target === voile) fini({ bouton: null, valeur: null }); });
    voile.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => {
      const input = voile.querySelector('#m-champ');
      fini({ bouton: b.dataset.b, valeur: input ? input.value.trim() : null });
    });
    document.body.appendChild(voile);
    (voile.querySelector('#m-champ') ?? voile.querySelector('[data-b]')).focus();
  });
}
const info = (titre, texte = '', humeur = null) => modale({ titre, texte, humeur }).then(() => {});
const confirme = async (titre, texte, humeur = null) => (await modale({ titre, texte, humeur, boutons: [{ id: 'non', label: 'Non' }, { id: 'oui', label: 'Oui', classe: 'principal' }] })).bouton === 'oui';
const demande = async (titre, label) => {
  const r = await modale({ titre, boutons: [{ id: 'non', label: 'Annuler' }, { id: 'oui', label: 'Envoyer', classe: 'principal' }], champ: { label } });
  return r.bouton === 'oui' ? r.valeur : null;
};

appliqueTheme(themeActuel());
if ((localStorage.getItem('duelo-motion') || (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full')) === 'reduced') document.documentElement.setAttribute('data-motion', 'reduced');
// Poignée de test (screenshots, debug) : ne fait que déclencher l'UI existante.
window.__duelo = { modale, info, confirme, demande };
router();

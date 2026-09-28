// DOM HUD, menus (title, pause, camp, inventory, journal, death, summit) and toasts.
import { ITEMS, RECIPES, FLORA, FAUNA, RELICS, BIVOUACS, ZONES, EAT_EFFECTS } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);

const REJECT_TEXT = {
  reach: 'Too far to reach.',
  support: 'You would fall — keep a hand on the rock.',
  occupied: 'No room on that hold.',
  low: 'Too low for a hand.',
  high: 'Too high for a foot.',
  cross: 'Can\'t cross your limbs that far.',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function bar(label, cls) {
  return `<div class="vital ${cls}"><span class="vlabel">${label}</span><div class="vbar"><div class="vfill"></div></div></div>`;
}

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.screen = null;
    this.lastReject = 0;
    root.innerHTML = `
      <div id="hud" class="hidden">
        <div class="vitals">
          ${bar('Health', 'health')}
          ${bar('Food', 'satiety')}
          ${bar('Water', 'hydration')}
          ${bar('Warmth', 'warmth')}
        </div>
        <div class="info">
          <div class="alt"><span id="altv">0</span> m</div>
          <div class="zone" id="zonev"></div>
          <div class="clock"><span id="dayv"></span> · <span id="timev"></span> · <span id="tempv"></span></div>
        </div>
        <div class="progress"><div class="ptrack"></div><div class="pdot"></div></div>
        <div class="quick">
          <button class="qbtn" data-act="piton" title="Place piton (F)"><b id="qpit">0</b><span>Pitons</span></button>
          <button class="qbtn" data-act="chalk" title="Chalk up (C)"><b id="qchalk">0</b><span>Chalk</span></button>
          <button class="qbtn" data-act="drink" title="Drink (T)"><b id="qwater">0</b><span>Water</span></button>
          <button class="qbtn" data-act="inv" title="Backpack (I)"><b>☰</b><span>Pack</span></button>
          <button class="qbtn" data-act="journal" title="Journal (J)"><b id="qjour">0%</b><span>Journal</span></button>
        </div>
        <div id="prompts"></div>
        <div id="dialogue" class="hidden" data-act="talk"><div class="dname-tag"></div><div class="dline"></div><div class="dnext">E / click ›</div></div>
        <div id="limbhint"></div>
      </div>
      <div id="toasts"></div>
      <div id="overlay" class="hidden"><div class="panel" id="panel"></div></div>
    `;
    this.hud = $('#hud', root);
    this.overlay = $('#overlay', root);
    this.panel = $('#panel', root);
    this.toasts = $('#toasts', root);
    this.prompts = $('#prompts', root);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      this.h.action(b.dataset.act, b.dataset);
    });
    this.progressBuilt = false;
  }

  toast(text, kind = 'info', ms = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 600);
  }

  discovery(ev) {
    const cat = { flora: 'Flora', fauna: 'Fauna', relics: 'Relic' }[ev.cat];
    const el = document.createElement('div');
    el.className = 'discovery';
    el.innerHTML = `<div class="dcat">New ${cat} entry</div><div class="dname">${esc(ev.entry.name)}</div><div class="dtext">${esc(ev.entry.text)}</div>`;
    this.root.appendChild(el);
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 6000);
  }

  reject(reason) {
    const now = performance.now();
    if (now - this.lastReject < 700) return;
    this.lastReject = now;
    if (REJECT_TEXT[reason]) this.toast(REJECT_TEXT[reason], 'warn', 1400);
  }

  showHUD(on) {
    this.hud.classList.toggle('hidden', !on);
  }

  buildProgress() {
    const track = $('.progress', this.root);
    for (let i = 0; i < BIVOUACS.length; i++) {
      const m = document.createElement('div');
      m.className = 'pmark';
      m.style.bottom = `${(-BIVOUACS[i].y / 9000) * 100}%`;
      m.dataset.i = i;
      track.appendChild(m);
    }
    this.progressBuilt = true;
  }

  updateHUD(game, controls) {
    if (!this.progressBuilt) this.buildProgress();
    const v = game.vitals;
    for (const k of ['health', 'satiety', 'hydration', 'warmth']) {
      const el = $(`.vital.${k}`, this.hud);
      el.querySelector('.vfill').style.width = `${Math.max(0, v[k])}%`;
      el.classList.toggle('low', v[k] < 25);
    }
    $('#altv').textContent = game.altitude().toLocaleString('en-US');
    $('#zonev').textContent = ZONES[game.zoneIndex()].name;
    $('#dayv').textContent = `Day ${game.day}`;
    $('#timev').textContent = game.clockString();
    $('#tempv').textContent = `${Math.round(game.temperature())}°C`;
    $('#qpit').textContent = game.inv.pitons;
    $('#qchalk').textContent = game.inv.chalk;
    $('#qwater').textContent = game.inv.water;
    $('#qjour').textContent = `${game.journalProgress().pct}%`;
    $('.pdot', this.hud).style.bottom = `${game.summitProgress() * 100}%`;
    for (const m of this.hud.querySelectorAll('.pmark')) {
      m.classList.toggle('done', !!game.journal.cairns[m.dataset.i] || game.lastBivouac >= Number(m.dataset.i));
    }
    // context prompts
    const c = game.climber;
    const ps = [];
    if (game.state === 'play') {
      if (c.state === 'climb' && c.mantleLedge()) ps.push(['mantle', 'W', 'Climb onto ledge']);
      const it = game.interactTarget();
      if (it && !game.dialogue) ps.push(['interact', 'E', game.interactLabel(it)]);
      const cl = game.campLedge();
      if (cl) ps.push(['camp', 'E', cl.summit ? 'Build the summit cairn' : `Make camp — ${cl.name}`]);
      if (game.pitonCandidate() && !game.hammer && game.inv.pitons > 0) ps.push(['piton', 'F', `Place piton (${game.inv.pitons} left)`]);
      if (game.hammer) ps.push(['piton', 'F', 'Strike!']);
      if (c.state === 'rope') ps.push(['none', 'W/S', 'Climb / lower rope · A/D swing']);
      if (c.stamina < 30 && c.chalkTime <= 0 && game.inv.chalk > 0 && c.state === 'climb') ps.push(['chalk', 'C', 'Chalk up']);
    }
    const key = ps.map((p) => p.join()).join('|');
    if (key !== this.lastPrompts) {
      this.lastPrompts = key;
      this.prompts.innerHTML = ps.map(([a, k, t]) => `<button class="prompt" data-act="${a}"><kbd>${k}</kbd>${esc(t)}</button>`).join('');
    }
    const dl = $('#dialogue', this.hud);
    const d = game.dialogue;
    dl.classList.toggle('hidden', !d);
    if (d) {
      const key = `${d.name}|${d.i}`;
      if (dl.dataset.key !== key) {
        dl.dataset.key = key;
        dl.querySelector('.dname-tag').textContent = d.name;
        dl.querySelector('.dline').textContent = d.lines[d.i];
      }
    }
    const lh = $('#limbhint', this.hud);
    const sel = controls.limb;
    const text = sel ? `${sel.name} selected — click a hold · Right-click to cancel` : '';
    if (lh.textContent !== text) lh.textContent = text;
  }

  // ---- screens -------------------------------------------------------------------------------------
  open(name, game) {
    this.screen = name;
    this.overlay.classList.remove('hidden');
    this.overlay.dataset.screen = name;
    this.render(game);
  }

  close() {
    this.screen = null;
    this.overlay.classList.add('hidden');
    this.panel.innerHTML = '';
    this.renderedScreen = null;
  }

  render(game) {
    const fn = this[`screen_${this.screen}`];
    if (!fn) return;
    const keep = this.renderedScreen === this.screen ? this.panel.scrollTop : 0;
    this.panel.innerHTML = fn.call(this, game);
    this.panel.scrollTop = keep;
    this.renderedScreen = this.screen;
  }

  screen_title(game, hasSave) {
    const cont = this.h.hasSave();
    return `
      <div class="title">
        <h1>VEYRA</h1>
        <p class="sub">A free-climbing survival journey</p>
        <div class="menu">
          ${cont ? '<button data-act="continue" class="primary">Continue climb</button>' : ''}
          <button data-act="new" class="${cont ? '' : 'primary'}">New climb</button>
          <button data-act="help">How to climb</button>
          <button data-act="settings">Settings</button>
        </div>
        <p class="foot">Inspired by <i>Cairn</i>. Every hold is a choice. Every ledge is a home.</p>
      </div>`;
  }

  screen_help() {
    return `
      <h2>How to climb</h2>
      <div class="help">
        <div><h3>Moving</h3>
          <p><b>Click a hold</b> — the best hand or foot reaches for it.<br>
          <b>Drag</b> a hand or foot (grab its circle) for precise placement.<br>
          <b>1–4</b> select left hand, right hand, left foot, right foot. <b>Right-click</b> cancels / lets go.<br>
          <b>WASD / arrows</b> shift your weight. On the ground or a ledge you walk (3D: in any direction, Shift runs).<br>
          <b>Drag with the mouse</b> on empty space (or right-drag) to look around in 3D.<br>
          <b>W</b> near a ledge lip: climb onto it (mantle).</p></div>
        <div><h3>Stamina</h3>
          <p>The ring next to the climber is your grip strength. It drains when you hang on small holds with your arms, and refills when your feet carry weight on good holds.
          Jugs and pockets are rests, crimps and slopers burn you out. <b>C</b> chalks your hands for a better grip. At zero, your hands let go.</p></div>
        <div><h3>Rope &amp; pitons</h3>
          <p>Holding a crack? Press <b>F</b> and hit F again in the green zone three times to hammer a piton. Your rope clips in — if you fall, you swing below it instead of hitting the ground.
          Badly set pitons can rip. On the rope: <b>W/S</b> climb or lower, <b>A/D</b> swing, click a hold to grab it.</p></div>
        <div><h3>Survival</h3>
          <p>Food, water and warmth lower your maximum stamina when they run low. Eat and drink from the pack (<b>I</b>, three points of contact). Springs refill your flask.
          It gets cold high up and at night.</p></div>
        <div><h3>Bivouacs</h3>
          <p>Stand on a bivouac ledge and press <b>E</b>: cook, sleep, build a cairn (save) and send <b>Pip</b> the climbot to fetch the pitons you left below.</p></div>
        <div><h3>The valley</h3>
          <p>At the foot of the wall you can walk around: talk to Tobi at base camp (<b>E</b>), pick berries, mushrooms and herbs that grow back every day, and fill your flask at the lake. Click a hold on the wall to walk over and start climbing.</p></div>
        <div><h3>Journal</h3>
          <p>Reach for rare flowers, find old relics on ledges and click animals to record sightings. Pip's scanner rings mark nearby secrets. <b>J</b> opens the journal.</p></div>
      </div>
      <div class="menu row"><button data-act="back" class="primary">Got it</button></div>`;
  }

  screen_settings() {
    const s = this.h.settings();
    return `
      <h2>Settings</h2>
      <div class="menu">
        <button data-act="toggle" data-key="sound">Sound: ${s.sound ? 'On' : 'Off'}</button>
        <button data-act="toggle" data-key="music">Music: ${s.music ? 'On' : 'Off'}</button>
        <button data-act="toggle" data-key="assist">Hold highlights: ${s.assist ? 'On' : 'Off'}</button>
        <button data-act="toggle" data-key="view3d">View: ${s.view3d ? '3D' : '2D'}</button>
        <button data-act="back" class="primary">Back</button>
      </div>`;
  }

  screen_pause(game) {
    return `
      <h2>Paused</h2>
      <div class="menu">
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="inv">Backpack</button>
        <button data-act="journal">Journal</button>
        <button data-act="help">How to climb</button>
        <button data-act="settings">Settings</button>
        <button data-act="quit">Quit to title</button>
      </div>`;
  }

  itemRows(game, filter) {
    return Object.keys(ITEMS)
      .filter((k) => filter(k))
      .map((k) => {
        const n = game.inv[k] || 0;
        const usable = EAT_EFFECTS[k] && n > 0;
        return `<div class="item ${n ? '' : 'none'}">
          <div class="iname">${esc(ITEMS[k].name)} <span class="icount">×${n}</span></div>
          <div class="idesc">${esc(ITEMS[k].desc)}</div>
          ${usable ? `<button data-act="use" data-item="${k}">${k === 'bandage' ? 'Apply' : k === 'water' || k === 'tea' ? 'Drink' : 'Eat'}</button>` : ''}
        </div>`;
      })
      .join('');
  }

  screen_inv(game) {
    const v = game.vitals;
    return `
      <h2>Backpack</h2>
      <div class="stats">Health ${Math.round(v.health)} · Food ${Math.round(v.satiety)} · Water ${Math.round(v.hydration)} · Warmth ${Math.round(v.warmth)} · Max stamina ${Math.round(game.staminaCap())}</div>
      ${game.canEat() ? '' : '<p class="warn">You need three points of contact (or a ledge) to use items.</p>'}
      <div class="items">${this.itemRows(game, () => true)}</div>
      <div class="menu row"><button data-act="close" class="primary">Close</button></div>`;
  }

  screen_camp(game) {
    const lg = game.camp.ledge;
    const below = game.pitonsBelowCamp().length;
    const recipes = RECIPES.map((r) => {
      const need = Object.entries(r.need).map(([k, n]) => `${n} ${ITEMS[k].name.toLowerCase()}`).join(' + ');
      const ok = game.canCook(r.out);
      return `<div class="item ${ok ? '' : 'none'}"><div class="iname">${esc(ITEMS[r.out].name)}</div><div class="idesc">${esc(need)} → ${esc(ITEMS[r.out].desc)}</div><button data-act="cook" data-item="${r.out}" ${ok ? '' : 'disabled'}>Cook</button></div>`;
    }).join('');
    return `
      <h2>${esc(lg.name)}</h2>
      <p class="sub">Bivouac ${lg.bivouac + 1} of ${BIVOUACS.length - 1} · ${game.altitude()} m · Day ${game.day}, ${game.clockString()}</p>
      <div class="camp-grid">
        <div>
          <h3>Camp</h3>
          <div class="menu">
            <button data-act="sleep">Sleep ${game.isNight() || game.time > 17 ? 'until morning' : '(3 hours)'}</button>
            <button data-act="refill">Fill flask at the trickle (${game.inv.water}/${ITEMS.water.max})</button>
            <button data-act="pip" ${below ? '' : 'disabled'}>Send Pip for pitons (${below} below)</button>
            <button data-act="cairn" ${game.journal.cairns[lg.bivouac] ? 'disabled' : ''}>${game.journal.cairns[lg.bivouac] ? 'Cairn built' : 'Build a cairn (save)'}</button>
          </div>
          <h3>Cook</h3>
          <div class="items">${recipes}</div>
        </div>
        <div>
          <h3>Eat &amp; drink</h3>
          <div class="items">${this.itemRows(game, (k) => EAT_EFFECTS[k] && (game.inv[k] || 0) > 0)}</div>
          <div class="stats">Health ${Math.round(game.vitals.health)} · Food ${Math.round(game.vitals.satiety)} · Water ${Math.round(game.vitals.hydration)} · Warmth ${Math.round(game.vitals.warmth)}</div>
        </div>
      </div>
      <div class="menu row"><button data-act="leave" class="primary">Break camp &amp; climb</button></div>`;
  }

  screen_journal(game) {
    const p = game.journalProgress();
    const sec = (title, list, cat) => `
      <h3>${title} <span class="count">${Object.keys(game.journal[cat]).length}/${list.length}</span></h3>
      <div class="entries">${list.map((e) => {
        const found = game.journal[cat][e.id];
        return found
          ? `<div class="entry found"><div class="ename">${esc(e.name)}</div><div class="etext">${esc(e.text)}</div><div class="emeta">Day ${found.day} · ${found.alt} m</div></div>`
          : `<div class="entry"><div class="ename">???</div><div class="etext">${cat === 'flora' || cat === 'fauna' ? `Somewhere in ${esc(ZONES[e.zone].name)}.` : 'Not yet found.'}</div></div>`;
      }).join('')}</div>`;
    const cairns = BIVOUACS.map((b, i) => `<span class="cairn ${game.journal.cairns[i] ? 'on' : ''}" title="${esc(b.name)}">▲</span>`).join('');
    return `
      <h2>Climber's Journal <span class="count">${p.pct}%</span></h2>
      <div class="cairns">Cairns: ${cairns}</div>
      <div class="journal">
        ${sec('Flora', FLORA, 'flora')}
        ${sec('Fauna', FAUNA, 'fauna')}
        ${sec('Relics of the first party', RELICS, 'relics')}
      </div>
      <div class="menu row"><button data-act="close" class="primary">Close</button></div>`;
  }

  screen_death(game) {
    return `
      <div class="title death">
        <h1>You fell.</h1>
        <p class="sub">${esc(game.deathReason || 'The mountain won this time.')}</p>
        <div class="menu">
          <button data-act="retry" class="primary">${game.lastBivouac >= 0 ? 'Return to last bivouac' : 'Start again from the base'}</button>
          <button data-act="quit">Quit to title</button>
        </div>
      </div>`;
  }

  screen_summit(game) {
    const s = game.stats;
    const p = game.journalProgress();
    const mins = Math.floor(s.playTime / 60);
    const hasMara = !!game.journal.relics.r8;
    return `
      <div class="title summit">
        <h1>Summit of Veyra</h1>
        <p class="sub">2,930 m. The wind goes quiet. You place the last stone on the cairn${hasMara ? ' — and beside it, Mara\'s painted stone. She made it. So did you.' : '.'}</p>
        <div class="stats big">
          <div><b>${mins}</b> min climbing</div>
          <div><b>${game.day}</b> days on the wall</div>
          <div><b>${s.moves}</b> moves</div>
          <div><b>${s.falls}</b> falls</div>
          <div><b>${s.pitons}</b> pitons hammered</div>
          <div><b>${p.pct}%</b> journal</div>
        </div>
        <div class="menu">
          <button data-act="journal">Read the journal</button>
          <button data-act="newseed" class="primary">Climb a new mountain</button>
          <button data-act="quit">Title screen</button>
        </div>
      </div>`;
  }
}

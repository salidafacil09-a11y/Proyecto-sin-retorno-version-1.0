(function (G) {
  'use strict';

  // Indicador de combate (abajo a la derecha, se puede mover con el editor de botones):
  // icono blanco del arma, balas "cargador | reserva" y la vida como un arco alrededor.
  //   toque corto     cambio rápido al arma anterior
  //   mantener        se despliega el selector: deslizas sin soltar hasta un arma (o una venda)
  //                   y al soltar la eliges (o te vendas)
  // En PC: Q igual (tocar = cambio rápido, mantener = selector, se elige moviendo el ratón).

  const HOLD_MS = 260;
  // Estilo del selector: 'agresivo' (cruz pequeña, como en los juegos de referencia) o 'clasico'
  // (dos columnas de tarjetas). Se elige en las opciones y se guarda en el navegador
  const STYLE_KEY = 'ceniza.hudestilo';
  let style = (() => { try { return localStorage.getItem(STYLE_KEY) || 'agresivo'; } catch (e) { return 'agresivo'; } })();
  let start = null;               // dónde empezó el gesto (cruz: se elige por dirección y distancia)
  let root = null, sel = null, player = null;
  let ring = null, icon = null, mag = null, res = null, pips = null, name = null, med = null;
  let open = false, hl = null, timer = null, pid = null, cards = [];
  let kbd = null;                 // selección con el ratón (PC): { x, y }
  let key = '';
  const onMsg = (m, k) => { if (HUD.onMessage) HUD.onMessage(m, k); };
  const el = (id) => document.getElementById(id);
  const W = () => G.Weapons;

  // ---------- Arco de vida ----------
  // de abajo (110°) a arriba (-110°) por la derecha, con pathLength 100
  function arcPath(cx, cy, r) {
    const a0 = 110 * Math.PI / 180, a1 = -110 * Math.PI / 180;
    const p = (a) => (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
    return 'M ' + p(a0) + ' A ' + r + ' ' + r + ' 0 1 0 ' + p(a1);
  }

  function init() {
    root = el('wpn'); sel = el('wsel');
    if (!root) return;
    document.body.classList.toggle('hud-clasico', style === 'clasico');
    const d = arcPath(60, 60, 52);
    root.querySelector('.wpn-ring').innerHTML =
      '<path class="ring-bg" pathLength="100" d="' + d + '"/><path class="ring-hp" pathLength="100" d="' + d + '"/>';
    ring = root.querySelector('.ring-hp');
    icon = root.querySelector('.wpn-ic'); mag = root.querySelector('.wpn-mag'); res = root.querySelector('.wpn-res');
    pips = root.querySelector('.wpn-pips'); name = root.querySelector('.wpn-name'); med = root.querySelector('.wpn-med');

    root.addEventListener('pointerdown', (e) => {
      if (G.Input.editing || !G.Input.enabled) return;
      e.preventDefault(); e.stopPropagation();
      pid = e.pointerId;
      try { root.setPointerCapture(pid); } catch (er) { /* nada */ }
      clearTimeout(timer);
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { timer = null; openSel(); highlight(e.clientX, e.clientY); }, HOLD_MS);
    });
    root.addEventListener('pointermove', (e) => { if (open && e.pointerId === pid) highlight(e.clientX, e.clientY); });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (timer) { clearTimeout(timer); timer = null; quick(); return; }
      if (open) { pick(); closeSel(); }
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', (e) => { if (e.pointerId === pid) { pid = null; clearTimeout(timer); timer = null; closeSel(); } });

    // PC: Q
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyQ' || e.repeat || !G.Input.enabled || G.Input.editing) return;
      e.preventDefault();
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; openSel(); kbd = { x: 0, y: 0 }; start = null; kbdHighlight(); }, HOLD_MS);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'KeyQ') return;
      if (timer) { clearTimeout(timer); timer = null; if (G.Input.enabled) quick(); return; }
      if (open) { pick(); closeSel(); }
    });
    window.addEventListener('mousemove', (e) => {
      if (!open || !kbd) return;
      kbd.x += e.movementX || 0; kbd.y += e.movementY || 0;
      kbdHighlight();
    });
  }

  function quick() {
    if (!player || player.dead) return;
    const m = player.quickSwap();
    if (m) onMsg(m);
  }

  // ---------- Selector ----------
  const SLOT_NAMES = ['Cuerpo a cuerpo', 'Pistola', 'Arma larga 1', 'Arma larga 2'];
  function cardHtml(c) {
    const u = c.id ? G.Icons.white(c.id) : null;
    return '<div class="ws-card' + (c.empty ? ' empty' : '') + (c.on ? ' on' : '') + (c.broken ? ' broken' : '') + '" data-k="' + c.k + '">' +
      '<span class="ws-ic">' + (u ? '<img alt="" src="' + u + '">' : (c.glyph || '')) + '</span>' +
      '<span class="ws-tx"><span class="ws-nm">' + c.name + '</span><span class="ws-ct">' + (c.txt || '') + '</span></span></div>';
  }
  function weaponText(s) {
    const w = W().get(s.id);
    if (W().isGun(w)) return s.broken ? 'ROTA' : (w.gun === 'bow' ? (s.mag ? '1' : '0') + ' | ' + player.ammo.flecha : s.mag + ' | ' + player.ammo[w.ammo]);
    return Math.max(0, Math.round(s.cond * w.cond)) + ' golpes';
  }
  function buildCards() {
    const p = player;
    const weapons = [0, 1, 2, 3].map((i) => {
      const s = p.hands[i];
      return s ? { k: 'w' + i, id: s.id, name: W().get(s.id).name, txt: weaponText(s), on: p.cur === i, broken: !!s.broken }
        : { k: 'w' + i, name: SLOT_NAMES[i], txt: 'vacío', empty: true };
    });
    weapons.push({ k: 'w-1', id: 'navaja', name: 'Navaja', txt: '', on: p.cur === -1 });
    weapons.push(p.throwable ? { k: 'w-2', id: p.throwable, name: thrName(p.throwable), txt: '', on: p.cur === -2 } : { k: 'w-2', name: 'Arrojable', txt: 'nada', empty: true });
    const items = [
      { k: 'i:venda', id: 'venda', name: 'Venda', txt: 'x' + p.items.venda, empty: !p.items.venda }
    ];
    return { weapons, items };
  }
  // ---------- Selector en cruz ----------
  // izquierda: armas de fuego largas · derecha: armas de fuego cortas · arriba: vendas ·
  // abajo: cuerpo a cuerpo (y manos libres). Se elige deslizando hacia un brazo de la cruz:
  // la dirección elige el brazo y la distancia, la casilla
  const STEP_X = 60, STEP_Y = 50, DEAD = 20;
  const CROSS_AT = [0.69, 0.41];      // centro de la cruz en la pantalla (fracción del ancho y del alto)
  let arms = null;
  function crossCard(c, x, y) {
    const u = c.id ? G.Icons.white(c.id) : null;
    return '<div class="wx-card' + (c.empty ? ' empty' : '') + (c.on ? ' on' : '') + (c.broken ? ' broken' : '') + '" data-k="' + c.k + '" data-name="' + c.name + '" style="left:' + x + 'px;top:' + y + 'px">' +
      (u ? '<img alt="" src="' + u + '">' : '<b>' + (c.glyph || '') + '</b>') + (c.txt ? '<span>' + c.txt + '</span>' : '') + '</div>';
  }
  function openCross() {
    const p = player;
    const wc = (i, name) => { const sl = p.hands[i]; return sl ? { k: 'w' + i, id: sl.id, name: W().get(sl.id).name, txt: shortText(sl), on: p.cur === i, broken: !!sl.broken } : { k: 'w' + i, name, empty: true }; };
    arms = {
      left: [wc(2, 'Arma larga'), wc(3, 'Arma larga')],
      right: [wc(1, 'Pistola')],
      up: [{ k: 'i:venda', id: 'venda', name: 'Venda', txt: String(p.items.venda), empty: !p.items.venda }],
      // abajo: cuerpo a cuerpo, la navaja y, debajo, el ladrillo o la botella
      down: [wc(0, 'Cuerpo a cuerpo'), { k: 'w-1', id: 'navaja', name: 'Navaja', on: p.cur === -1 },
        p.throwable ? { k: 'w-2', id: p.throwable, name: thrName(p.throwable), on: p.cur === -2 } : { k: 'w-2', name: 'Arrojable', empty: true }]
    };
    const W2 = STEP_X * 2 + 30, H2 = STEP_Y * 3 + 26;
    let h = '<div class="wx-label"></div><i class="wx-dot"></i>';
    arms.left.forEach((c, i) => { h += crossCard(c, W2 - STEP_X * (i + 1), H2); });
    arms.right.forEach((c, i) => { h += crossCard(c, W2 + STEP_X * (i + 1), H2); });
    arms.up.forEach((c, i) => { h += crossCard(c, W2, H2 - STEP_Y * (i + 1)); });
    arms.down.forEach((c, i) => { h += crossCard(c, W2, H2 + STEP_Y * (i + 1)); });
    sel.className = 'cross';
    sel.innerHTML = h;
    sel.style.width = (W2 * 2) + 'px'; sel.style.height = (H2 * 2) + 'px';
    sel.classList.remove('hidden');
    // la cruz se abre siempre en el mismo sitio (a la derecha, algo por encima del centro),
    // esté donde esté el indicador que la abre
    const Wd = window.innerWidth, H = window.innerHeight;
    let cx = Wd * CROSS_AT[0], cy = H * CROSS_AT[1];
    cx = Math.max(W2 + 4, Math.min(Wd - W2 - 4, cx)); cy = Math.max(H2 + 4, Math.min(H - H2 - 4, cy));
    sel.style.left = (cx - W2) + 'px'; sel.style.top = (cy - H2) + 'px';
    cards = Array.from(sel.querySelectorAll('.wx-card'));
  }
  // elige por la dirección y la distancia del gesto desde donde empezó
  function crossPick(dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d < DEAD) { setHl(null); return; }
    let arm, n;
    if (Math.abs(dx) > Math.abs(dy)) { arm = dx < 0 ? 'left' : 'right'; n = Math.floor((Math.abs(dx) - DEAD) / (STEP_X * 0.75)); }
    else { arm = dy < 0 ? 'up' : 'down'; n = Math.floor((Math.abs(dy) - DEAD) / (STEP_Y * 0.75)); }
    const list = arms[arm];
    const c = list[Math.max(0, Math.min(list.length - 1, n))];
    setHl(cards.find((e) => e.dataset.k === c.k) || null);
  }
  function thrName(id) { return id === 'ladrillo' ? 'Ladrillo' : (id === 'molotov' ? 'Molotov' : 'Botella'); }
  function shortText(sl) {
    const w = W().get(sl.id);
    if (W().isGun(w)) return sl.broken ? 'ROTA' : (w.gun === 'bow' ? String(player.ammo.flecha) : sl.mag + '|' + player.ammo[w.ammo]);
    return String(Math.max(0, Math.round(sl.cond * w.cond)));
  }

  function openSel() {
    if (!player || player.dead || !sel) return;
    open = true; hl = null;
    G.Input.blockLook = true;
    if (style === 'agresivo') { openCross(); return; }
    sel.className = '';
    sel.style.width = sel.style.height = '';
    const { weapons, items } = buildCards();
    sel.innerHTML = '<div class="ws-col ws-items">' + items.map(cardHtml).join('') + '</div>' +
      '<div class="ws-col ws-weapons">' + weapons.map(cardHtml).join('') + '</div>';
    sel.classList.remove('hidden');
    // se abre hacia el centro de la pantalla, junto al indicador
    const r = root.getBoundingClientRect(), Wd = window.innerWidth, H = window.innerHeight;
    const sw = sel.offsetWidth, sh = sel.offsetHeight;
    let x = r.left + r.width / 2 > Wd / 2 ? r.left - sw - 8 : r.right + 8;
    let y = r.top + r.height / 2 > H / 2 ? r.bottom - sh : r.top;
    x = Math.max(6, Math.min(Wd - sw - 6, x)); y = Math.max(6, Math.min(H - sh - 6, y));
    sel.style.left = x + 'px'; sel.style.top = y + 'px';
    cards = Array.from(sel.querySelectorAll('.ws-card'));
  }
  function closeSel() {
    open = false; kbd = null; hl = null;
    G.Input.blockLook = false;
    if (sel) sel.classList.add('hidden');
  }
  function setHl(c) {
    if (hl === c) return;
    if (hl) hl.classList.remove('hl');
    hl = c;
    if (hl) hl.classList.add('hl');
    const lb = sel && sel.querySelector('.wx-label');
    if (lb) lb.textContent = hl ? hl.dataset.name : '';
  }
  function highlight(x, y) {
    if (style === 'agresivo') { if (start) crossPick(x - start.x, y - start.y); return; }
    let best = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 3 && y <= r.bottom + 3) best = c;
    }
    setHl(best);
  }
  // PC: el ratón mueve la selección (filas de 46 px; a la izquierda, la columna de vendas)
  function kbdHighlight() {
    if (style === 'agresivo') { crossPick(kbd.x * 0.6, kbd.y * 0.6); return; }
    const col = kbd.x < -70 ? sel.querySelectorAll('.ws-items .ws-card') : sel.querySelectorAll('.ws-weapons .ws-card');
    const list = Array.from(col);
    const cur = list.findIndex((c) => c.classList.contains('on'));
    let i = (cur >= 0 ? cur : 0) + Math.round(kbd.y / 46);
    i = Math.max(0, Math.min(list.length - 1, i));
    setHl(list[i]);
  }
  function pick() {
    if (!hl || !player) return;
    const k = hl.dataset.k;
    if (k.charAt(0) === 'w') {
      const i = parseInt(k.slice(1), 10);
      if (i >= 0 && !player.hands[i]) return;
      if (i === -2 && !player.throwable) return;
      if (player.busy()) { onMsg('Ahora no puedes cambiar de arma'); return; }
      if (i !== player.cur) { player.equip(i); onMsg(i >= 0 ? 'En las manos: ' + player.weapon.name : (i === -2 ? thrName(player.throwable) + ': apunta para ver dónde cae' : 'Navaja')); }
    } else {
      const m = player.startBandage(k.slice(2));
      if (m) onMsg(m, 'warn');
    }
  }

  // ---------- Cada fotograma ----------
  function update(p, state) {
    player = p;
    if (!root) return;
    const s = p.slot, w = p.weapon, gun = W().isGun(w) && !!s;
    const hp = Math.max(0, Math.round(p.health));
    const k2 = [hp, p.bleeding, p.infected, p.cur, s ? s.id + (s.broken ? 'R' : '') : '', s ? s.mag : '', s ? Math.round((s.cond || 0) * 100) : '',
      gun ? p.ammo[w.ammo] : '', p.items.venda, p.backpack, style, p.throwable || ''].join('|');
    if (k2 === key) return;
    key = k2;
    ring.style.strokeDasharray = hp + ' 100';
    root.classList.toggle('bleed', p.bleeding);
    root.classList.toggle('sick', !!p.infected);
    root.classList.toggle('low', hp < 30);
    const u = G.Icons.white(p.holdingThr ? p.throwable : (s ? s.id : 'navaja'));
    if (u) { icon.src = u; icon.classList.remove('hidden'); } else icon.classList.add('hidden');
    name.textContent = '';
    root.classList.toggle('gun', gun);
    root.classList.toggle('broken', !!(s && s.broken));
    if (gun) {
      const bow = w.gun === 'bow';
      mag.textContent = s.broken ? '—' : (bow ? (s.mag ? 1 : 0) : s.mag);
      const r = p.ammo[w.ammo];
      res.textContent = r;
      res.classList.toggle('full', r >= p.ammoCap(w.ammo));
      // munición del cargador como rayitas (como en el juego de referencia)
      const n = bow ? 1 : w.mag;
      let h = '';
      for (let i = 0; i < n; i++) h += '<i' + (i < s.mag ? ' class="on"' : '') + '></i>';
      pips.innerHTML = h;
    } else if (s) {
      // cuerpo a cuerpo: golpes que le quedan
      const n = w.cond, left = Math.max(0, Math.round(s.cond * n));
      mag.textContent = ''; res.textContent = '';
      let h = '';
      for (let i = 0; i < n; i++) h += '<i' + (i < left ? ' class="on"' : '') + '></i>';
      pips.innerHTML = h;
    } else { mag.textContent = ''; res.textContent = ''; pips.innerHTML = ''; }
    // HUD agresivo: sin el atajo de la venda bajo el arma (se usa desde el selector, la mochila o B)
    const nv = style === 'clasico' ? p.items.venda : 0;
    med.classList.toggle('hidden', !nv);
    if (nv) med.innerHTML = '<img alt="" src="' + (G.Icons.white('venda') || '') + '"><span>' + nv + '</span>';
  }

  const HUD = {
    init, update, get selecting() { return open; }, onMessage: null,
    get style() { return style; },
    setStyle(v) { style = v === 'clasico' ? 'clasico' : 'agresivo'; try { localStorage.setItem(STYLE_KEY, style); } catch (e) { /* nada */ } document.body.classList.toggle('hud-clasico', style === 'clasico'); }
  };
  G.HUD = HUD;
})(window.Game = window.Game || {});

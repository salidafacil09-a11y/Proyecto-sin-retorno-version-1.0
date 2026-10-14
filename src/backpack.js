(function (G) {
  'use strict';

  // Mochila (o bolsillos, si aún no la tienes). Se abre con un toque y el personaje se agacha a
  // rebuscar: el mundo NO se pausa. Tiene:
  //   - las armas a mano y las guardadas (toca una larga y luego una guardada para cambiarlas,
  //     o arrástrala encima)
  //   - materiales y objetos (vendas, alcohol, vendas desinfectadas) para usar
  //   - fabricar: venda + alcohol = venda desinfectada (mantén pulsado)
  // La munición no se ve aquí: está en el indicador de combate.

  const CRAFT_MS = 1200;
  let box = null, player = null, selKey = null, onMsg = null;
  let crafting = null;          // { t0, raf }
  let dragFrom = null;
  const el = (id) => document.getElementById(id);
  const W = () => G.Weapons;
  const msg = (m, k) => { if (onMsg) onMsg(m, k); };

  const TXT = {
    venda: 'Recupera 40 de vida en unos segundos. Tardas un par de segundos en ponértela.',
    venda_d: 'Corta la hemorragia, evita la infección y recupera vida poco a poco (unos 30 puntos en un minuto).',
    alcohol: 'Alcohol para desinfectar. Con 2 botellas y un trapo fabricas una venda.',
    trapo: 'Un trapo limpio. Con 2 botellas de alcohol fabricas una venda.',
    molotov: 'Se lanza como la botella, pero al romperse prende un charco de fuego: los infectados que alcanza arden, se sacuden las llamas unos segundos y van perdiendo vida; el más cercano cae y se revuelca hasta morir. Cuidado: el fuego también te quema.',
    recipe: 'Receta: 2 botellas de alcohol + 1 trapo.'
  };

  function ensure() {
    if (box) return box;
    box = el('pack');
    if (!box) return null;
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.querySelector('.pk-x').addEventListener('pointerdown', (e) => { e.preventDefault(); close(true); });
    box.addEventListener('click', (e) => {
      const c = e.target.closest('[data-k]');
      if (!c || c.classList.contains('pk-hold')) return;
      tapCard(c.dataset.k);
    });
    // arrastrar un arma sobre otra la cambia
    box.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.pk-card[data-k^="h"], .pk-card[data-k^="s"]');
      dragFrom = c ? c.dataset.k : null;
    });
    box.addEventListener('pointerup', (e) => {
      if (!dragFrom) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const c = t && t.closest('.pk-card[data-k^="h"], .pk-card[data-k^="s"]');
      if (c && c.dataset.k !== dragFrom) { swap(dragFrom, c.dataset.k); selKey = c.dataset.k; render(); }
      dragFrom = null;
    });
    // mantener para fabricar o usar
    box.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.pk-hold');
      if (!b) return;
      e.preventDefault();
      startCraft(b);
    });
    const stop = () => stopCraft(false);
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);
    box.addEventListener('pointerleave', stop);
    window.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.code === 'Escape' || e.code === 'KeyI') { e.preventDefault(); close(true); }
    });
    document.addEventListener('pointerlockchange', () => { if (isOpen() && G.Input.pointerLocked) close(false); });
    return box;
  }

  const isOpen = () => !!(box && !box.classList.contains('hidden'));

  function open(p) {
    player = p;
    if (!ensure() || p.dead) return false;
    if (isOpen()) { close(true); return false; }
    if (p.busy()) { msg('Ahora no puedes'); return false; }
    if (G.Loot && G.Loot.isOpen) G.Loot.close(false);
    if (p.stance === 'prone') p.stance = 'crouch';
    p.aiming = false;
    p.action = { kind: 'pack', t: 0, dur: 1e9, impact: 2, face: p.facing, done: false };
    selKey = selKey || 'r:venda';
    box.classList.remove('hidden');
    render();
    if (!G.Input.isTouch && G.Input.pointerLocked && document.exitPointerLock) document.exitPointerLock();
    return true;
  }

  function close(relock) {
    if (!isOpen()) return;
    stopCraft(false);
    box.classList.add('hidden');
    if (player && player.action && player.action.kind === 'pack') player.action = null;
    if (relock && !G.Input.isTouch && G.Input.enabled && G.Input.requestLock) G.Input.requestLock();
  }

  // ---------- Contenido ----------
  function wText(s) {
    const w = W().get(s.id);
    if (W().isGun(w)) return s.broken ? 'ROTA' : Math.round((s.cond == null ? 1 : s.cond) * 100) + ' %';
    return Math.max(0, Math.round(s.cond * w.cond)) + ' golpes';
  }
  function card(k, id, label, txt, extra) {
    const u = id ? G.Icons.white(id) : null;
    return '<button type="button" class="pk-card' + (extra || '') + (selKey === k ? ' sel' : '') + '" data-k="' + k + '">' +
      '<span class="pk-ic">' + (u ? '<img alt="" src="' + u + '">' : '') + '</span>' +
      '<span class="pk-nm">' + label + '</span>' + (txt != null ? '<span class="pk-ct">' + txt + '</span>' : '') + '</button>';
  }

  function render() {
    if (!box || !player) return;
    const p = player;
    box.querySelector('.pk-title').textContent = p.backpack ? 'Mochila' : 'Bolsillos';
    const names = ['Cuerpo a cuerpo', 'Pistola', 'Arma larga', 'Arma larga'];
    box.querySelector('.pk-hands').innerHTML = [0, 1, 2, 3].map((i) => {
      const s = p.hands[i];
      return s ? card('h' + i, s.id, W().get(s.id).name, wText(s), (s.broken ? ' broken' : '') + (p.cur === i ? ' cur' : ''))
        : card('h' + i, null, names[i], 'vacío', ' empty');
    }).join('');
    box.querySelector('.pk-stored').innerHTML = p.backpack
      ? [0, 1].map((i) => { const s = p.stored[i]; return s ? card('s' + i, s.id, W().get(s.id).name, wText(s), s.broken ? ' broken' : '') : card('s' + i, null, 'Arma guardada', 'vacío', ' empty'); }).join('')
      : '<div class="pk-lock">Sin mochila no puedes guardar armas</div>';
    box.querySelector('.pk-mats').innerHTML =
      card('m:venda', 'venda', 'Venda', p.items.venda + ' / ' + W().SUPPLY.venda.cap[p.backpack ? 1 : 0]) +
      card('m:alcohol', 'alcohol', 'Alcohol', p.items.alcohol + ' / ' + W().SUPPLY.alcohol.cap[p.backpack ? 1 : 0], p.items.alcohol ? '' : ' empty') +
      card('m:trapo', 'trapo', 'Trapo', p.items.trapo + ' / ' + W().SUPPLY.trapo.cap[p.backpack ? 1 : 0], p.items.trapo ? '' : ' empty');
    const okC = p.items.alcohol >= 2 && p.items.trapo >= 1;
    const okM = p.throwable === 'botella' && p.items.alcohol >= 1;
    box.querySelector('.pk-craft').innerHTML = card('r:venda', 'venda', 'Venda', '2 alcohol + 1 trapo', okC ? '' : ' empty') +
      card('r:molotov', 'molotov', 'Molotov', 'botella + 1 alcohol', okM ? '' : ' empty');
    const dv = box.querySelector('.pk-dev');
    if (dv) dv.innerHTML = G.DEV ? W().LIST.filter((w) => w.cat !== 'none').map((w) => card('dev:' + w.id, w.id, w.name, W().isGun(w) ? 'de fuego' : 'cuerpo a cuerpo')).join('') : '';
    describe();
  }

  function describe() {
    const p = player, d = box.querySelector('.pk-desc');
    const k = selKey || '';
    let title = '', text = '', act = '';
    if (k.charAt(0) === 'h' || k.charAt(0) === 's') {
      const i = +k.slice(1), s = k.charAt(0) === 'h' ? p.hands[i] : p.stored[i];
      if (!s) { title = k.charAt(0) === 'h' ? 'Espacio vacío' : 'Espacio de la mochila vacío'; text = k.charAt(0) === 's' ? 'Toca un arma larga a mano para guardarla aquí.' : 'Encontrarás armas registrando muebles.'; }
      else {
        const w = W().get(s.id);
        title = w.name;
        text = W().isGun(w)
          ? (s.broken ? 'Está rota: no dispara. Se podrá arreglar en un banco de taller.' : 'Estado: ' + wText(s) + '.')
          : 'Le quedan ' + wText(s) + '. Al romperse desaparece.';
        if (p.backpack && (k === 'h2' || k === 'h3' || k.charAt(0) === 's')) text += ' Toca ' + (k.charAt(0) === 's' ? 'un arma larga a mano' : 'un arma guardada') + ' para cambiarlas.';
        if (k.charAt(0) === 'h') act = '<button type="button" class="pk-btn" data-k="eq' + i + '">' + (p.cur === i ? 'Guardar en la funda' : 'Equipar') + '</button>';
      }
    } else if (k === 'm:venda' || k === 'm:venda_d') {
      const id = k.slice(2);
      title = W().nameOf(id); text = TXT[id];
      if (p.items[id]) act = '<button type="button" class="pk-btn" data-k="use:' + id + '">Usar</button>';
    } else if (k === 'm:alcohol' || k === 'm:trapo') {
      const id = k.slice(2);
      title = W().nameOf(id); text = TXT[id] + ' Tienes ' + p.items.alcohol + ' de alcohol y ' + p.items.trapo + ' trapo' + (p.items.trapo === 1 ? '' : 's') + '.';
    } else if (k === 'r:molotov') {
      title = 'Fabricar molotov'; text = TXT.molotov + ' Necesitas la botella para lanzar (' + (p.throwable === 'botella' ? 'la llevas' : (p.throwable ? 'llevas otra cosa' : 'no la llevas')) + ') y 1 botella de alcohol (tienes ' + p.items.alcohol + ').';
      const ok = p.throwable === 'botella' && p.items.alcohol >= 1;
      act = '<button type="button" class="pk-btn pk-hold' + (ok ? '' : ' off') + '" data-k="craft:molotov"><i class="pk-fill"></i><span>' + (ok ? 'Mantén para fabricar' : 'Te faltan materiales') + '</span></button>';
    } else if (k === 'r:venda') {
      title = 'Fabricar venda'; text = TXT.venda + ' ' + TXT.recipe + ' Tienes ' + p.items.alcohol + ' de alcohol y ' + p.items.trapo + ' trapo' + (p.items.trapo === 1 ? '' : 's') + '.';
      const full = p.itemRoom('venda') <= 0, ok = p.items.alcohol >= 2 && p.items.trapo >= 1 && !full;
      act = '<button type="button" class="pk-btn pk-hold' + (ok ? '' : ' off') + '" data-k="craft"><i class="pk-fill"></i><span>' + (ok ? 'Mantén para fabricar' : (full ? 'No caben más' : 'Te faltan materiales')) + '</span></button>';
    }
    d.innerHTML = '<b>' + title + '</b><p>' + text + '</p><div class="pk-acts">' + act + '</div>';
  }

  // tocar: seleccionar; tocar un arma con otra seleccionada: cambiarlas
  function tapCard(k) {
    const p = player;
    if (k.indexOf('eq') === 0) { const i = +k.slice(2); if (p.hands[i]) { p.cur === i ? p.equip(-1) : p.equip(i); } render(); return; }
    if (k.indexOf('use:') === 0) {
      const id = k.slice(4);
      close(false);
      const m = p.startBandage(id);
      if (m) msg(m, 'warn');
      return;
    }
    if (k === 'craft' || k === 'craft:molotov') return;
    if (k.indexOf('dev:') === 0) { const m = p.devGive(k.slice(4)); if (m) msg(m); render(); return; }
    const w1 = selKey && (selKey.charAt(0) === 'h' || selKey.charAt(0) === 's');
    const w2 = k.charAt(0) === 'h' || k.charAt(0) === 's';
    if (w1 && w2 && selKey !== k && swap(selKey, k)) { selKey = k; render(); return; }
    selKey = k;
    render();
  }

  // cambia un arma larga a mano (h2/h3) con una guardada (s0/s1)
  function swap(a, b) {
    const p = player;
    let h = null, s = null;
    for (const k of [a, b]) { if (k === 'h2' || k === 'h3') h = +k.slice(1); else if (k.charAt(0) === 's') s = +k.slice(1); }
    if (h == null || s == null || !p.backpack) return false;
    if (!p.hands[h] && !p.stored[s]) return false;
    p.swapStored(h, s);
    msg('Cambiaste de arma: ' + (p.hands[h] ? W().get(p.hands[h].id).name + ' a mano' : 'guardada en la mochila'));
    return true;
  }

  // ---------- Fabricar (mantener pulsado) ----------
  function startCraft(b) {
    if (b.classList.contains('off')) return;
    const fill = b.querySelector('.pk-fill');
    const recipe = b.dataset.k === 'craft:molotov' ? 'molotov' : 'venda';
    crafting = { t0: performance.now(), fill };
    const step = () => {
      if (!crafting) return;
      const k = Math.min(1, (performance.now() - crafting.t0) / CRAFT_MS);
      fill.style.width = (k * 100) + '%';
      if (k >= 1) {
        crafting = null;
        const m = player.craft(recipe);
        msg(m || (recipe === 'molotov' ? 'Fabricaste una molotov: lánzala como la botella' : 'Fabricaste una venda'), m ? 'warn' : 'good');
        render();
        return;
      }
      crafting.raf = requestAnimationFrame(step);
    };
    crafting.raf = requestAnimationFrame(step);
  }
  function stopCraft() {
    if (!crafting) return;
    cancelAnimationFrame(crafting.raf);
    if (crafting.fill) crafting.fill.style.width = '0%';
    crafting = null;
  }

  // Cada fotograma: se cierra si algo te interrumpe (un golpe) o mueres
  function update(p) {
    player = p;
    if (!isOpen()) return;
    if (p.dead || !p.action || p.action.kind !== 'pack') close(false);
  }

  G.Backpack = {
    open, close, update, render,
    get isOpen() { return isOpen(); },
    set onMessage(fn) { onMsg = fn; }
  };
})(window.Game = window.Game || {});

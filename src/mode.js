(function (G) {
  'use strict';

  // Modo Asalto: aguantar oleadas de infectados en el mapa pequeño (inspirado en el modo por oleadas del
  // vídeo de referencia; textos, tiempos y puntuación propios).
  //   preparación (20 s, «OLEADA ENTRANTE») → oleada 1/3 → «PRÓXIMA OLEADA EN…» → 2/3 → … → 3/3 →
  //   «ENFRENTAMIENTO COMPLETADO» → «REGRESANDO AL ESCONDITE» (15 s) → estadísticas y puntuación.
  // Los de las oleadas son cazadores: saben dónde estás. En la última llegan también dos ciegos.
  // Desafío de la partida: agarrar y matar a uno por sorpresa (recompensa: 2 vendas).
  // En este modo los mordiscos hacen daño pero no infectan.

  const U = G.Util;
  const SPEAKER = 'Vera';                  // la protagonista (nombre propio)
  const PREP = 20, BETWEEN = 20, RETURN = 15, BANNER = 4;
  const WAVES = [
    { runners: 4, blind: 0, alive: 3 },
    { runners: 6, blind: 0, alive: 4 },
    { runners: 6, blind: 2, alive: 5 }
  ];
  const MAX_CORPSES = 8;
  const BARKS = {
    start: ['Vamos allá.', 'Que vengan.', 'Respira... tú puedes.'],
    wave: ['Ahí vienen.', 'Los oigo.', 'Prepárate.'],
    blind: ['Ciegos. Sin hacer ruido.', 'Ese no ve... pero oye.'],
    kill: ['Uno menos.', 'Quieto.', 'Ya está.', 'Fuera.', 'No te levantes.'],
    free: ['¡Suéltame!', '¡Aparta!', '¡Quita de encima!'],
    stealth: ['Shh...', 'Tranquilo... duérmete.'],
    last: ['Queda uno.', 'El último.'],
    clear: ['Bien.', 'Despejado.', 'Por ahora...'],
    done: ['Lo logramos.', 'Hora de volver.'],
    hurt: ['¡Ah!', '¡Agh!'],
    reload: ['Recargando.', 'Cubridme... ah, no hay nadie.']
  };

  let scene = null, player = null;
  let st = null;            // estado de la partida
  const el = (id) => document.getElementById(id);
  const $ = {};

  function newStats() {
    return { kills: 0, melee: 0, exec: 0, gunKills: 0, head: 0, shots: 0, hits: 0, stun: 0, escapes: 0, hurt: 0, stealth: 0, thrown: 0, picked: 0, time: 0 };
  }

  const Mode = {
    active: false, fighting: false, stats: null, onMessage: null, onFinish: null,

    init(sc, pl) {
      scene = sc; player = pl;
      for (const k of ['mode-hud', 'm-title', 'm-timer', 'm-tlabel', 'm-tval', 'm-wave', 'm-wlabel', 'm-bar', 'm-icons', 'm-chal', 'm-cn', 'm-banner', 'm-btext', 'm-sub', 'm-stats', 'm-rows', 'm-total']) $[k] = el(k);
    },

    // Empieza una partida nueva de Asalto (el mundo y la protagonista ya están reiniciados)
    start() {
      this.active = true; this.fighting = false;
      this.stats = newStats();
      G.Combat.stats = this.stats;
      st = { phase: 'prep', t: PREP, wave: 0, queue: [], spawnT: 0, list: [], corpses: [], seen: new Set(), barkT: 0, chal: false, chalShown: false, titleT: 7, hurtHp: player.health, blindT: 0 };
      // equipo de salida: navaja, pistola con el cargador lleno y algo de munición, y una venda
      if (!G.DEV) {
        player.pickUp('pistola', G.Weapons.get('pistola').mag, 1);
        player.ammo['9mm'] = 4;
        player.items.venda = Math.max(player.items.venda, 1);
        player.equip(-1);
      }
      player.noInfect = true;
      G.Pickups.spawn(9);
      $['mode-hud'].classList.remove('hidden');
      $['m-title'].classList.remove('hidden', 'out');
      $['m-wave'].classList.add('hidden');
      $['m-banner'].classList.add('hidden');
      $['m-stats'].classList.add('hidden');
      this.setTimer('OLEADA ENTRANTE', PREP);
      this.renderChal();
      setTimeout(() => this.bark('start'), 1200);
    },

    stop() {
      this.active = false; this.fighting = false;
      G.Combat.stats = null; this.stats = null; st = null;
      if (player) player.noInfect = false;
      if ($['mode-hud']) $['mode-hud'].classList.add('hidden');
      if ($['m-stats']) $['m-stats'].classList.add('hidden');
      if ($['m-sub']) $['m-sub'].classList.add('hidden');
    },

    // ---------- Frases (subtítulos abajo al centro) ----------
    bark(kind) {
      if (!this.active || !st) return;
      const L = BARKS[kind];
      if (!L) return;
      // no hablar a cada rato (salvo lo importante)
      const now = performance.now() / 1000;
      if (kind === 'kill' && (now - (st.lastBark || 0) < 6 || Math.random() < 0.45)) return;
      if (now - (st.lastBark || 0) < 1.2) return;
      st.lastBark = now;
      const line = L[Math.floor(Math.random() * L.length)];
      const s = $['m-sub'];
      s.innerHTML = '<b>' + ((player && player.charName) || SPEAKER) + ':</b> ' + line;
      s.classList.remove('hidden');
      clearTimeout(s._t);
      s._t = setTimeout(() => s.classList.add('hidden'), 2600);
    },

    // ---------- HUD ----------
    setTimer(label, t) {
      const tm = $['m-timer'];
      if (!label) { tm.classList.add('hidden'); return; }
      tm.classList.remove('hidden');
      if ($['m-tlabel'].textContent !== label) $['m-tlabel'].textContent = label;
      const v = Math.max(0, t).toFixed(1);
      if ($['m-tval'].textContent !== v) $['m-tval'].textContent = v;
    },
    renderWave() {
      const w = WAVES[st.wave - 1], total = w.runners + w.blind;
      const left = st.queue.length + st.list.filter((z) => z.alive).length;
      $['m-wlabel'].textContent = 'Oleada ' + st.wave + '/' + WAVES.length;
      $['m-bar'].firstElementChild.style.width = (left / total * 100).toFixed(1) + '%';
      // un muñeco por enemigo que queda (los ciegos, con la cabeza marcada)
      const key = left + '|' + st.queue.filter((q) => q.blind).length + '|' + st.list.filter((z) => z.alive && z.blind).length;
      if ($['m-icons']._k !== key) {
        $['m-icons']._k = key;
        let h = '';
        const nb = st.queue.filter((q) => q.blind).length + st.list.filter((z) => z.alive && z.blind).length;
        for (let i = 0; i < left; i++) h += '<i class="' + (i < nb ? 'b' : '') + '"></i>';
        $['m-icons'].innerHTML = h;
      }
    },
    renderChal() {
      const c = $['m-chal'];
      c.classList.toggle('done', !!st.chal);
      $['m-cn'].textContent = (st.chal ? 1 : 0) + '/1';
    },
    banner(text, sec) {
      $['m-btext'].textContent = text;
      $['m-banner'].classList.remove('hidden');
      clearTimeout($['m-banner']._t);
      $['m-banner']._t = setTimeout(() => $['m-banner'].classList.add('hidden'), sec * 1000);
    },

    // ---------- Oleadas ----------
    beginWave(n) {
      st.wave = n; st.phase = 'wave';
      const w = WAVES[n - 1];
      st.queue = [];
      for (let i = 0; i < w.runners; i++) st.queue.push({ blind: false });
      // los ciegos llegan a mitad de la oleada
      for (let i = 0; i < w.blind; i++) st.queue.splice(2 + i * 2, 0, { blind: true });
      st.spawnT = 1.2;
      this.fighting = true;
      this.setTimer(null);
      $['m-title'].classList.add('hidden');
      $['m-wave'].classList.remove('hidden');
      this.renderWave();
      this.bark(w.blind ? 'wave' : 'wave');
      if (this.onMessage) this.onMessage('Oleada ' + n + ' de ' + WAVES.length, 'bad');
    },

    // sitio para que aparezca uno: lejos (18 a 45 m), donde no lo veas, en el suelo y libre
    spawnPoint() {
      const W = G.World, A0 = W.ARENA_MIN + 2, A1 = W.ARENA_MAX - 2;
      // distancias según el tamaño del mapa (en el campo de pruebas de 40 m, entre 12 y unos 22 m)
      const size = A1 - A0, dMin = Math.min(16, size * 0.33), dBest = Math.min(28, size * 0.6);
      const cf = G.Camera.forward();
      let best = null, bs = -Infinity;
      for (let i = 0; i < 60; i++) {
        const x = U.lerp(A0, A1, Math.random()), z = U.lerp(A0, A1, Math.random());
        const d = Math.hypot(x - player.pos.x, z - player.pos.z);
        if (d < dMin || W.circleBlocked(x, z, 0.4, 0)) continue;
        let s = -Math.abs(d - dBest) * 0.15;
        const ang = Math.atan2(x - player.pos.x, z - player.pos.z);
        if (Math.abs(U.angleDiff(ang, Math.atan2(cf.x, cf.z))) > 1.2) s += 2;     // fuera de cámara
        if (!W.hasLOS(player.pos.x, player.pos.z, x, z, 0)) s += 2;                // detrás de algo
        if (W.isIndoor(Math.floor(x), Math.floor(z), 0)) s -= 0.5;
        if (s > bs) { bs = s; best = { x, z }; }
      }
      return best;
    },

    spawnOne(q) {
      const p = this.spawnPoint();
      if (!p) return false;
      const zb = new G.Zombie(scene, p.x, p.z, null, Math.atan2(player.pos.x - p.x, player.pos.z - p.z), { hunter: true, blind: q.blind, lv: 0 });
      zb.wave = st.wave;
      if (!q.blind) { zb.state = 'chase'; zb.target = { x: player.pos.x, z: player.pos.z, lv: 0 }; zb.lastSeen = 0; zb.screamed = true; }
      else { zb.target = { x: player.pos.x + (Math.random() - 0.5) * 8, z: player.pos.z + (Math.random() - 0.5) * 8, lv: 0 }; zb.enter('investigate', 10); }
      G.Population.list.push(zb);
      st.list.push(zb);
      if (q.blind && !st.blindSaid) { st.blindSaid = true; setTimeout(() => this.bark('blind'), 1500); }
      return true;
    },

    // ---------- Cada fotograma ----------
    update(dt) {
      if (!this.active || !st || player.dead) return;
      const s = this.stats;
      if (st.phase !== 'stats') s.time += dt;
      // título del principio
      if (st.titleT > 0) { st.titleT -= dt; if (st.titleT <= 0) $['m-title'].classList.add('out'); }
      // daño recibido (los mordiscos y arañazos ya cuentan en Combat; aquí lo demás, como sangrar)
      st.hurtHp = player.health;
      // muertes nuevas
      for (const z of st.list) {
        if (z.alive || st.seen.has(z)) continue;
        st.seen.add(z);
        s.kills++;
        if (z.killedBy === 'gun') s.gunKills++;
        else s.melee++;
        if (z.killedBy === 'stealth' && !st.chal) {
          st.chal = true; this.renderChal();
          player.items.venda = Math.min(player.items.venda + 2, G.Weapons.SUPPLY.venda.cap[player.backpack ? 1 : 0]);
          if (this.onMessage) this.onMessage('Desafío completado: +2 vendas', 'good');
        }
        st.corpses.push(z);
        if (z.killedBy !== 'exec' && z.killedBy !== 'stealth') this.bark('kill');
      }
      // los cadáveres más viejos se hunden y desaparecen (rendimiento)
      while (st.corpses.length > MAX_CORPSES) {
        const z = st.corpses[0];
        if (z.fall < 1) break;
        z.sink = (z.sink || 0) + dt * 0.35;
        z.lift = -z.sink;
        if (z.sink > 0.45) {
          st.corpses.shift();
          const i = G.Population.list.indexOf(z);
          if (i >= 0) G.Population.list.splice(i, 1);
          const j = st.list.indexOf(z);
          if (j >= 0) st.list.splice(j, 1);
          z.dispose();
        } else break;
      }
      // ciegos de la oleada: se acercan a donde estás aunque no hagas ruido (a tientas)
      st.blindT -= dt;
      if (st.blindT <= 0) {
        st.blindT = 4;
        for (const z of st.list) {
          if (!z.alive || !z.blind || !(z.state === 'idle' || z.state === 'wander')) continue;
          z.target = { x: player.pos.x + (Math.random() - 0.5) * 7, z: player.pos.z + (Math.random() - 0.5) * 7, lv: player.lv || 0 };
          z.enter('investigate', 9);
        }
      }

      switch (st.phase) {
        case 'prep':
          st.t -= dt;
          this.setTimer('OLEADA ENTRANTE', st.t);
          if (st.t <= 0) this.beginWave(1);
          break;
        case 'wave': {
          const w = WAVES[st.wave - 1];
          st.spawnT -= dt;
          const alive = st.list.filter((z) => z.alive).length;
          if (st.queue.length && st.spawnT <= 0 && alive < w.alive) {
            if (this.spawnOne(st.queue[0])) st.queue.shift();
            st.spawnT = 1.4 + Math.random() * 1.8;
          }
          this.renderWave();
          const left = st.queue.length + alive;
          if (left === 1 && !st.lastSaid) { st.lastSaid = true; this.bark('last'); }
          if (left === 0) {
            st.lastSaid = false;
            this.fighting = false;
            if (st.wave < WAVES.length) {
              st.phase = 'between'; st.t = BETWEEN;
              $['m-wave'].classList.add('hidden');
              setTimeout(() => this.bark('clear'), 600);
              // reabastecimiento: objetos nuevos repartidos por el mapa
              G.Pickups.spawn(5);
              if (this.onMessage) this.onMessage('Oleada superada. Hay suministros por el mapa', 'good');
            } else {
              st.phase = 'complete'; st.t = BANNER;
              $['m-wave'].classList.add('hidden');
              this.banner('ENFRENTAMIENTO COMPLETADO', BANNER);
              setTimeout(() => this.bark('done'), 900);
            }
          }
          break;
        }
        case 'between':
          st.t -= dt;
          this.setTimer('PRÓXIMA OLEADA EN…', st.t);
          if (st.t <= 0) this.beginWave(st.wave + 1);
          break;
        case 'complete':
          st.t -= dt;
          if (st.t <= 0) { st.phase = 'return'; st.t = RETURN; }
          break;
        case 'return':
          st.t -= dt;
          this.setTimer('REGRESANDO AL ESCONDITE', st.t);
          if (st.t <= 0) { st.phase = 'stats'; this.setTimer(null); this.showStats(true); }
          break;
      }
    },

    // ---------- Puntuación ----------
    score(win) {
      const s = this.stats;
      const acc = s.shots ? s.hits / s.shots : 0;
      const rows = [
        ['RENDIMIENTO', '', ''],
        ['Finalización del enfrentamiento', win ? '' : 'oleada ' + (st ? st.wave : 0) + '/3', win ? 100 : 0],
        ['Finalización por tiempo', fmtTime(s.time), win ? Math.max(0, Math.round(100 - Math.max(0, s.time - 240) / 6)) : 0],
        ['Daño recibido', Math.round(s.hurt), Math.max(0, Math.round(100 - s.hurt * 0.6))],
        ['Precisión', s.shots ? Math.round(acc * 100) + ' %' : '—', Math.round(acc * 100)],
        ['BONIFICACIÓN', '', ''],
        ['Aturdir', s.stun, s.stun * 5],
        ['Muertes cuerpo a cuerpo', s.melee, s.melee * 5],
        ['Remates', s.exec, s.exec * 5],
        ['Disparos a la cabeza', s.head, s.head * 5],
        ['Forcejeos ganados', s.escapes, s.escapes * 5],
        ['Desafío: matar por sorpresa', st && st.chal ? 1 : 0, st && st.chal ? 20 : 0]
      ];
      let total = 0;
      for (const r of rows) if (typeof r[2] === 'number') total += r[2];
      return { rows, total };
    },

    showStats(win) {
      const { rows, total } = this.score(win);
      let h = '';
      for (const r of rows) {
        if (r[2] === '') h += '<div class="ms-sec"><span>' + r[0] + '</span><span>ESTADÍSTICAS</span><span>PUNTAJE</span></div>';
        else h += '<div class="ms-row"><span>' + r[0] + '</span><span>' + r[1] + '</span><span>' + r[2] + '</span></div>';
      }
      $['m-rows'].innerHTML = h;
      $['m-total'].textContent = total;
      el('m-stitle').textContent = win ? 'ENFRENTAMIENTO COMPLETADO' : 'ENFRENTAMIENTO FALLIDO';
      $['m-stats'].classList.remove('hidden');
      $['mode-hud'].classList.add('hidden');
      if (this.onFinish) this.onFinish(win, total);
    },

    // para la pantalla de muerte
    summary() {
      if (!this.active || !st) return '';
      return 'Oleada ' + st.wave + '/' + WAVES.length + ' · Infectados eliminados: ' + this.stats.kills + ' · Tiempo ' + fmtTime(this.stats.time);
    },
    get phase() { return st ? st.phase : null; },
    skip() { if (st) { st.t = 0; st.spawnT = 0; } },          // para pruebas: salta la cuenta atrás
    get wave() { return st ? st.wave : 0; },
    WAVES
  };

  function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ' min ' + (s < 10 ? '0' : '') + s + ' s'; }

  G.Mode = Mode;
})(window.Game = window.Game || {});

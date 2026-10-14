(function (G) {
  'use strict';

  // acciones de pelea cuerpo a cuerpo (para la guardia y la cámara de pelea)
  const MELEE_KINDS = { punch1: 1, punch2: 1, punch3: 1, swing1: 1, swing1b: 1, swing2: 1, swing2b: 1, overhead: 1, stab: 1, slash: 1, thrust: 1, shove: 1, stomp: 1, bash: 1, runatk: 1, runshove: 1, finisher: 1, kslash1: 1, kslash2: 1, kstab: 1 };

  const BANDAGE_HEAL = 40;      // vida que recupera cada venda
  const U = G.Util;
  // Velocidades (m/s)
  // Como en el video: con el joystick a fondo trota (rápido); con Correr va a toda velocidad.
  // Joystick a medias: camina. Agachado avanza bastante rápido; corriendo agachado, más.
  const WALK = 3.6, RUN = 5.4, AIM_WALK = 1.6, AIM_RUN = 3.2, CROUCH_WALK = 1.9, CROUCH_RUN = 3.3, PRONE_WALK = 0.6;
  const REF_AMT = 2.0;            // velocidad a la que la animación de las piernas llega al máximo
  const NOISE_CROUCH_RUN = 3.5;   // corriendo agachado se oye menos que corriendo de pie
  const ACCEL = 11, DECEL = 14;   // inercia del movimiento omnidireccional
  const RADIUS = 0.28;
  const COVER_ON = false;         // cobertura automática junto a paredes (desactivada por ahora)
  const DODGE_DIST = 1.6;         // metros que recorre la esquiva
  const NOISE_RUN = 7;            // los zombis te oyen correr a esta distancia
  const NOISE_WALK = 2;           // caminando de pie solo te oyen muy de cerca (agachado o tumbado, nada)

  // Personajes elegibles (diseños propios). Los dos usan las mismas animaciones
  const CHARS = {
    // Vera: mujer joven y atlética, pelo castaño muy oscuro en una trenza corta, remera blanca gastada,
    // vendas en el antebrazo izquierdo y el codo derecho, pantalón cargo oliva y botas marrones
    vera: { name: 'Vera', opts: {
      skin: 0xd4a487, shirt: 0xe4dfd3, pants: 0x4b4a37, hair: 0x2b1b12, shoes: 0x4a3426, lips: 0xb0705f,
      longSleeves: false, cuffs: false, collar: null, belt: null, pocket: true,
      hero: true, female: true, braid: true, scale: 0.94 } },
    // Tomás (el protagonista anterior): pelo corto castaño, barba de unos días, remera blanca gastada,
    // vendas, vaqueros y botas
    tomas: { name: 'Tomás', opts: {
      skin: 0xd2a07a, shirt: 0xe2ddd0, pants: 0x34405a, hair: 0x3a2a1c, shoes: 0x3b3029, lips: 0xa06a58,
      longSleeves: false, cuffs: false, collar: null, belt: null, pocket: true,
      beard: 0x5a4030, hero: true } }
  };

  class Player {
    constructor(scene) {
      this.scene = scene;
      this.charId = 'vera';
      this.buildModel();
      this.reset();
    }

    buildModel() {
      const c = CHARS[this.charId];
      this.model = G.Models.createHumanoid(c.opts);
      this.female = !!c.opts.female;
      this.charName = c.name;
      this.scene.add(this.model.root);
    }

    // Cambia de personaje (desde el menú)
    setCharacter(id) {
      if (!CHARS[id] || id === this.charId) return;
      const old = this.model;
      if (old && old.root.parent) old.root.parent.remove(old.root);
      this.charId = id;
      this.buildModel();
      this.refreshModel();
    }

    reset() {
      const s = G.World.SPAWN;
      this.pos = { x: s.x, z: s.z };
      this.vel = { x: 0, z: 0 };
      this.lv = 0;               // planta (0 = baja, 1 = arriba)
      this.y = G.World.groundY(s.x, s.z, 0);
      this.facing = Math.PI;
      this.health = 100;
      this.stamina = 1;
      this.noise = 0;
      this.noiseLevel = 0;
      this.hurt = 0;
      this.phase = 0;
      this.moveAmt = 0;
      this.moveRel = 0;          // dirección del movimiento respecto a donde mira el cuerpo
      this.running = false;
      this.aiming = false;
      this.stance = 'stand';     // stand | crouch | prone
      this.crouchAmt = 0;
      this.proneAmt = 0;
      this.hop = null;
      this.action = null;
      this.struggle = null;      // forcejeo con un infectado que te agarró
      this.grabCD = 0;           // segundos sin que te puedan volver a agarrar
      this.climb = null;
      this.blow = null; this.blowKb = null; this.dodging = null; this.dodgeAfter = 0;
      this.beaten = null;        // un infectado te está dando su combo de golpes (nadie más te pega)
      this.throwable = null;     // ladrillo o botella en la mano libre (solo uno a la vez)
      // Armas a mano: 0 cuerpo a cuerpo · 1 pistola · 2 y 3 armas de fuego largas (a la espalda).
      // Cada una { id, cond, two } (armas de fuego: mag = balas cargadas, sil = silenciador, broken = rota)
      this.hands = [null, null, null, null];
      this.stored = [null, null];  // armas largas guardadas en la mochila
      this.backpack = true;        // por ahora la mochila se lleva siempre (antes se encontraba)
      this.items = { venda: 0, venda_d: 0, alcohol: 0, trapo: 0 };
      this.ammo = { '9mm': 0, cartucho: 0, rifle: 0, flecha: 0 };
      this.silencers = 0;        // silenciadores sin poner
      this.prev = -1;            // arma anterior (cambio rápido)
      this.heal = 0;             // vida que aún va a recuperar (vendas desinfectadas)
      this.infRisk = 0;          // probabilidad de infección de heridas sin vendar
      this.infRiskT = 0;         // segundos hasta que esa infección se decide
      this.gun = { aim: 0, recoil: 0, bloom: 0, draw: 0, cycle: null, reload: null, rw: 0, ru: 0, cooldown: 0, arrow: false };
      this.cur = -1;             // -1 = manos libres
      this.cover = null;         // cobertura: agachado junto a una pared o valla
      this.coverAmt = 0;
      this.scope = false;        // mira telescópica puesta (rifle)
      this.bleed = 0;
      this.bleedRate = 0;
      this.infected = false;
      this.infectTime = 0;
      this.sick = false;
      this.wounds = 0;
      this.dead = false;
      this.deathCause = '';
      this.model.root.visible = true;
      this.model.body.rotation.set(0, 0, 0);
      this.model.body.position.set(0, 0, 0);
      G.Models.setWeapon(this.model, null);
      G.Models.setBackWeapon(this.model, null);
      G.Models.setBackpack(this.model, this.backpack);
      this._thrShown = false;
      this.refreshModel();          // la navaja en la mano desde el principio
      this.apply();
    }

    // Sin sistema de resistencia: siempre al máximo (correr, golpear y empujar no cansan)
    get stamina() { return 1; }
    set stamina(v) { /* nada */ }

    // sin otra arma en las manos, la navaja
    get weapon() { return this.cur >= 0 && this.hands[this.cur] ? G.Weapons.get(this.hands[this.cur].id) : G.Weapons.KNIFE; }
    get slot() { return this.cur >= 0 ? this.hands[this.cur] : null; }
    // todas las armas que llevas (a mano y guardadas)
    get weapons() { return this.hands.concat(this.stored).filter(Boolean); }
    set weapons(list) {
      this.hands = [null, null, null, null]; this.stored = [null, null]; this.cur = -1; this.prev = -1;
      for (const s of list || []) this.place(s);
      this.refreshModel && this.model && this.refreshModel();
    }
    get crouching() { return this.stance === 'crouch'; }
    get prone() { return this.stance === 'prone'; }
    // 0 de pie, 1 agachado, 2 tumbado: cuanto más alto, más difícil que te vean
    get stealth() { return this.stance === 'prone' ? 2 : (this.stance === 'crouch' ? 1 : 0); }

    // Pruebas de desarrollador: un juego completo de armas, munición llena y vendas
    applyDev() {
      this.backpack = true;
      this.hands = [null, null, null, null]; this.stored = [null, null];
      this.cur = -1;
      for (const id of ['bate', 'pistola', 'escopeta', 'rifle', 'arco']) {
        const w = G.Weapons.get(id);
        this.pickUp(id, G.Weapons.isGun(w) ? w.mag : 1, 1);
      }
      for (const a in this.ammo) this.ammo[a] = this.ammoCap(a);
      this.items.venda = Math.max(this.items.venda, 3);
      this.equip(-1);
      this.refreshModel();
    }

    // Armería de pruebas: pone cualquier arma en su espacio (cuerpo a cuerpo, pistola o larga) y la equipa
    devGive(id) {
      const w = G.Weapons.get(id);
      if (!w || w.cat === 'none' || this.busy()) return null;
      const gun = G.Weapons.isGun(w);
      let i;
      if (!gun) i = 0;
      else if (w.gun === 'pistol') i = 1;
      else {
        for (let k = 2; k <= 3; k++) if (this.hands[k] && this.hands[k].id === id) { this.equip(k); return 'En las manos: ' + w.name; }
        i = this.cur === 3 ? 3 : 2;
      }
      const slot = { id, cond: 1, two: w.hands === 2 };
      if (gun) slot.mag = w.mag;
      this.hands[i] = slot;
      for (const a in this.ammo) this.ammo[a] = this.ammoCap(a);
      this.equip(i);
      this.refreshModel();
      return 'En las manos: ' + w.name;
    }

    busy() { return !!(this.action || this.climb || this.dodging || (this.blow && this.blow.t < 0.5)); }

    // Te alcanza un zombi: el cuerpo acusa el golpe (se echa atrás o de lado y retrocede un paso).
    // Corta el golpe que estabas dando. La cámara no se toca.
    takeBlow(z, type) {
      const dx = this.pos.x - z.pos.x, dz = this.pos.z - z.pos.z, l = Math.hypot(dx, dz) || 1;
      const rel = U.angleDiff(Math.atan2(-dx, -dz), this.facing);      // de dónde viene (0 = de frente)
      const bite = type === 'mordisco';
      this.blow = { t: 0, dur: bite ? 1.0 : 0.6, rel, bite };
      const f = bite ? 1.2 : 2.2;
      this.blowKb = { x: dx / l * f, z: dz / l * f };
      const a = this.action;
      if (a && a.kind !== 'finisher' && a.kind !== 'grab' && a.kind !== 'bandage') this.action = null;
    }

    // Puñetazo o golpe en carrera de un infectado: reacciona como reaccionaban ellos a tus golpes (gancho:
    // cabeza y torso de lado; golpe fuerte: atrás con los brazos arriba) y retrocede
    takePunch(z, react, fl, push) {
      const dx = this.pos.x - z.pos.x, dz = this.pos.z - z.pos.z, l = Math.hypot(dx, dz) || 1;
      const rel = U.angleDiff(Math.atan2(-dx, -dz), this.facing);
      const heavy = react === 'heavy';
      this.blow = { t: 0, dur: heavy ? 0.95 : 0.6, rel, bite: false, react, fl };
      // de lado: hacia su derecha (fl +1) o su izquierda, además de un poco atrás
      const rx = -Math.cos(this.facing), rz = Math.sin(this.facing);
      const lat = heavy ? 0.15 : 0.55;
      this.blowKb = { x: (dx / l + rx * fl * lat) * push, z: (dz / l + rz * fl * lat) * push };
      const a = this.action;
      if (a && a.kind !== 'finisher' && a.kind !== 'grab' && !a.exec) this.action = null;
      this.dodging = null;
    }

    // Lo que hace que el personaje nunca parezca quieto: inclinarse al girar y al acelerar, jadear después
    // de correr, mirar al infectado más cercano, ponerse en guardia con la oleada y gestos sueltos en reposo
    life(dt, vlen) {
      if (dt <= 0) return;
      const L = this.lf || (this.lf = { face: this.facing, v: 0, turn: 0, acc: 0, breath: 0, bt: 0, idle: 0, look: null, ly: 0, lp: 0, lw: 0, alert: 0, fid: null, next: 6 + Math.random() * 5 });
      const tr = U.angleDiff(this.facing, L.face) / dt;
      L.face = this.facing;
      L.turn += (U.clamp(tr, -6, 6) - L.turn) * Math.min(1, dt * 8);
      const ac = (vlen - L.v) / dt;
      L.v = vlen;
      L.acc += (U.clamp(ac, -12, 12) - L.acc) * Math.min(1, dt * 6);
      const sprint = this.running && !this.crouchRun && vlen > 3.5;
      L.breath = U.clamp(L.breath + (sprint ? dt * 0.16 : -dt * 0.07), 0, 1);
      L.bt += dt * (1.7 + 1.9 * L.breath);
      // infectado más cercano delante o a los lados (no detrás): la cabeza lo sigue
      let best = null, bd = 14;
      const zs = G.Population ? G.Population.list : [];
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (!z.alive || (z.lv || 0) !== (this.lv || 0)) continue;
        const dx = z.pos.x - this.pos.x, dz = z.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d >= bd) continue;
        const rel = U.angleDiff(Math.atan2(dx, dz), this.facing);
        if (Math.abs(rel) > 2.1) continue;
        best = { rel, d, y: z.y }; bd = d;
      }
      if (best) {
        L.ly += (best.rel - L.ly) * Math.min(1, dt * 7);
        L.lp += (Math.atan2(0.08 + (this.y - best.y) * 0.8, Math.max(0.6, best.d)) - L.lp) * Math.min(1, dt * 7);
      }
      L.lw += ((best ? 1 : 0) - L.lw) * Math.min(1, dt * 4);
      L.look = L.lw > 0.02 ? { yaw: L.ly, pitch: L.lp, w: L.lw } : null;
      // guardia: con una oleada en marcha o si alguno te persigue cerca
      let chased = false;
      for (let i = 0; i < zs.length && !chased; i++) {
        const z = zs[i];
        if (z.alive && (z.state === 'chase' || z.state === 'attack' || z.state === 'alert') && Math.hypot(z.pos.x - this.pos.x, z.pos.z - this.pos.z) < 18) chased = true;
      }
      const alertOn = chased || !!(G.Mode && G.Mode.fighting);
      L.alert += ((alertOn ? 1 : 0) - L.alert) * Math.min(1, dt * (alertOn ? 3 : 0.8));
      // gestos sueltos tras un rato quieto
      const still = this.moveAmt < 0.05 && !this.action && !this.aiming && !this.climb && !this.prone && L.alert < 0.5;
      if (L.fid) { L.fid.t += dt / L.fid.dur; if (L.fid.t >= 1 || !still) L.fid = null; }
      L.idle = still ? L.idle + dt : 0;
      if (!L.fid && L.idle > L.next) {
        const kinds = ['look', 'neck', 'shake', 'look'];
        L.fid = { kind: kinds[Math.floor(Math.random() * kinds.length)], t: 0, dur: 1.6 + Math.random() * 0.6, side: Math.random() < 0.5 ? 1 : -1 };
        L.idle = 0; L.next = 6 + Math.random() * 7;
      }
    }

    // Agachado o tumbado, los ruidos que haces (puertas, golpes) llegan menos lejos
    get noiseMul() { return this.stance === 'prone' ? 0.35 : (this.stance === 'crouch' ? 0.5 : 1); }

    setStance(s) {
      if (this.dead || this.climb) return;
      this.stance = s;
      if (s === 'prone') G.Input.setAim && G.Input.setAim(false);
    }
    toggleCrouch() { this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch'); }
    toggleProne() { this.setStance(this.stance === 'prone' ? 'stand' : 'prone'); }

    // ---------- Armas ----------
    // Espacios: 1 cuerpo a cuerpo (de cualquier tamaño), 1 pistola y 2 armas de fuego largas a la
    // espalda; con mochila, 2 armas largas más guardadas. No se sueltan: las cuerpo a cuerpo se
    // rompen y desaparecen; las de fuego se rompen y se quedan (inservibles hasta arreglarlas).
    get twoHanded() { const s = this.slot; return !!(s && s.two); }
    get backSlots() {
      const out = [];
      for (const i of [2, 3]) if (this.hands[i] && i !== this.cur) out.push(this.hands[i]);
      // un arma cuerpo a cuerpo larga guardada va a la espalda si queda sitio
      const m = this.hands[0];
      if (m && this.cur !== 0 && out.length < 2 && G.Weapons.isLong(G.Weapons.get(m.id))) out.push(m);
      return out;
    }

    // ¿Dónde iría esta arma? { where: 'hand'|'stored', i, replace } o null si no cabe
    spotFor(id) {
      const k = G.Weapons.kindOf(id);
      if (k < 0) return null;
      if (this.weapons.some((s) => s.id === id && !s.broken)) return null;      // ya la tienes
      if (k === 0) return !this.hands[0] ? { where: 'hand', i: 0 } : null;
      if (k === 1) return !this.hands[1] ? { where: 'hand', i: 1 } : (this.hands[1].broken ? { where: 'hand', i: 1, replace: true } : null);
      for (const i of [2, 3]) if (!this.hands[i]) return { where: 'hand', i };
      if (this.backpack) for (let i = 0; i < 2; i++) if (!this.stored[i]) return { where: 'stored', i };
      // un arma de fuego rota se cambia por la nueva
      for (const i of [2, 3]) if (this.hands[i].broken) return { where: 'hand', i, replace: true };
      if (this.backpack) for (let i = 0; i < 2; i++) if (this.stored[i].broken) return { where: 'stored', i, replace: true };
      return null;
    }
    canTake(id) {
      if (G.Weapons.isItem(id)) return this.itemRoom(id) > 0;
      return !!this.spotFor(id);
    }

    place(s) {
      const sp = this.spotFor(s.id);
      if (!sp) return null;
      const arr = sp.where === 'hand' ? this.hands : this.stored;
      const old = sp.replace ? arr[sp.i] : null;
      arr[sp.i] = s;
      return { sp, old };
    }

    // ladrillo o botella en la mano (espacio -2 de la cruz)
    get holdingThr() { return this.cur === -2 && !!this.throwable; }
    refreshModel() {
      const sl = this.slot;
      G.Models.setWeapon(this.model, this.holdingThr ? this.throwable : (sl ? sl.id : 'navaja'), sl && sl.sil ? { sil: true } : null);
      G.Models.setBackWeapon(this.model, this.backSlots.map((b) => b.id), this.backpack);
      if (G.Models.setBackpack) G.Models.setBackpack(this.model, this.backpack);
    }

    equip(i) {
      if (i === -2 && !this.throwable) i = -1;
      if (i >= 0 && !this.hands[i]) i = -1;
      if (i !== this.cur) this.prev = this.cur;
      this.cur = i;
      if (i >= 0 && this.hands[i] && G.Weapons.isGun(G.Weapons.get(this.hands[i].id))) this.lastGun = i;
      this.gun.reload = null; this.gun.cycle = null; this.gun.draw = 0; this.gun.aim = 0;
      this.refreshModel();
    }

    // Elegir un espacio (1 cuerpo a cuerpo, 2 pistola, 3 y 4 largas); el mismo otra vez = manos libres
    selectSlot(n) {
      if (this.busy()) return null;
      const i = n - 1;
      if (!this.hands[i]) return null;
      this.equip(i === this.cur ? -1 : i);
      return this.cur >= 0 ? 'En las manos: ' + this.weapon.name : 'Navaja';
    }

    // Siguiente arma a mano (después de la última, manos libres)
    cycleWeapon() {
      if (this.busy()) return null;
      const order = [-1, 0, 1, 2, 3], at = order.indexOf(this.cur);
      for (let k = 1; k <= 5; k++) {
        const i = order[(at + k) % 5];
        if (i === -1 || this.hands[i]) { this.equip(i); return i >= 0 ? 'En las manos: ' + this.weapon.name : 'Navaja'; }
      }
      return null;
    }

    // Desenfunde rápido: el último arma de fuego que usaste (si ya no la tienes, la primera que haya)
    gunSlot() {
      const ok = (i) => i >= 0 && this.hands[i] && G.Weapons.isGun(G.Weapons.get(this.hands[i].id));
      if (ok(this.lastGun)) return this.lastGun;
      for (const i of [1, 2, 3]) if (ok(i)) return i;
      return -1;
    }

    // Cambio rápido: vuelve al arma anterior
    quickSwap() {
      if (this.busy()) return null;
      let p = this.prev;
      if (p >= 0 && !this.hands[p]) p = -1;
      if (p === this.cur) return null;
      this.equip(p);
      return this.cur >= 0 ? 'En las manos: ' + this.weapon.name : 'Navaja';
    }

    // Intercambia un arma larga a mano (espacio 2 o 3) con una guardada en la mochila
    swapStored(handI, storeI) {
      if (!this.backpack || (handI !== 2 && handI !== 3)) return false;
      const a = this.hands[handI], b = this.stored[storeI];
      this.hands[handI] = b; this.stored[storeI] = a;
      if (this.cur === handI) { this.gun.reload = null; this.gun.cycle = null; this.gun.draw = 0; if (!b) this.cur = -1; }
      this.refreshModel();
      return true;
    }

    // ---------- Objetos: munición, accesorios, curación y mochila ----------
    ammoCap(a) { return G.Weapons.AMMO[a].cap * (this.backpack ? G.Weapons.BAG_MUL : 1); }
    // Cuánto más cabe de un objeto
    itemRoom(id) {
      const a = G.Weapons.ammoOfItem(id);
      if (a) return Math.max(0, this.ammoCap(a) - this.ammo[a]);
      if (id === 'silenciador') return 99;
      if (id === 'mochila') return this.backpack ? 0 : 1;
      const sp = G.Weapons.SUPPLY[id];
      if (!sp) return 0;
      return Math.max(0, sp.cap[this.backpack ? 1 : 0] - this.items[id]);
    }

    // Coge n de un objeto (lo que quepa). Devuelve { msg, left }
    takeItem(id, n) {
      const room = this.itemRoom(id);
      if (room <= 0) {
        const sp = G.Weapons.SUPPLY[id];
        return { msg: sp && !sp.cap[0] && !this.backpack ? 'Necesitas una mochila para llevar ' + G.Weapons.nameOf(id).toLowerCase() : 'No te cabe más: ' + G.Weapons.nameOf(id).toLowerCase(), left: n };
      }
      const k = Math.min(n, room), left = n - k;
      const a = G.Weapons.ammoOfItem(id);
      let msg;
      if (a) { this.ammo[a] += k; msg = 'Cogiste ' + k + ' ' + G.Weapons.AMMO[a].name; }
      else if (id === 'silenciador') {
        const s = this.hands[1];
        if (s && !s.sil) { s.sil = 20; this.refreshModel(); msg = 'Silenciador puesto en la pistola (V lo quita y lo pone)'; }
        else { this.silencers++; msg = 'Cogiste un silenciador (sirve para la pistola)'; }
      } else if (id === 'mochila') {
        this.backpack = true; this.refreshModel();
        msg = 'Te pusiste la mochila: más espacio para munición y vendas, y 2 armas largas guardadas';
      } else {
        this.items[id] += k;
        msg = id === 'alcohol' ? 'Cogiste ' + (k === 1 ? 'una botella' : k + ' botellas') + ' de alcohol (' + this.items.alcohol + ')'
          : id === 'trapo' ? 'Cogiste ' + (k === 1 ? 'un trapo' : k + ' trapos') + ' (' + this.items.trapo + ')'
          : 'Cogiste ' + (k === 1 ? 'una ' : k + ' ') + G.Weapons.nameOf(id).toLowerCase() + (k === 1 ? '' : 's');
        if ((id === 'alcohol' || id === 'trapo') && this.items.alcohol >= 2 && this.items.trapo >= 1) msg += ' · puedes fabricar una venda en la mochila';
      }
      if (left > 0) msg += ' · no te cabe el resto';
      return { msg, left };
    }

    // Coge un arma: va a su espacio. Devuelve { ok, old (arma rota que dejas), equipped } o { ok: false }
    pickUp(id, cond, dur) {
      const w = G.Weapons.get(id);
      const slot = { id, cond, two: w.hands === 2 };
      if (G.Weapons.isGun(w)) {
        slot.cond = dur != null ? dur : 1;
        if (slot.cond <= 0) { slot.cond = 0; slot.broken = true; }
        slot.mag = Math.max(0, Math.min(w.mag, Math.round(cond || 0)));
        if (w.gun === 'pistol' && this.silencers > 0) { this.silencers--; slot.sil = 20; }
      }
      const r = this.place(slot);
      if (!r) return { ok: false };
      let equipped = false;
      if (r.sp.where === 'hand' && !this.busy()) { this.equip(r.sp.i); equipped = true; }
      else this.refreshModel();
      return { ok: true, old: r.old, equipped, stored: r.sp.where === 'stored' };
    }

    // Accesorio (V / LB): con la pistola pone o quita el silenciador; con el rifle, apuntando, la mira telescópica
    toggleGrip() {
      const s = this.slot;
      if (!s) return null;
      const w = this.weapon;
      if (!G.Weapons.isGun(w)) return null;
      if (w.scope) {
        if (!this.aiming) return null;
        this.scope = !this.scope;
        return null;
      }
      if (this.busy() || w.gun !== 'pistol') return null;
      if (s.sil) { this.silencers++; s.silStore = s.sil; s.sil = 0; this.refreshModel(); return 'Quitaste el silenciador'; }
      if (this.silencers > 0) { this.silencers--; s.sil = s.silStore || 20; s.silStore = 0; this.refreshModel(); return 'Pusiste el silenciador'; }
      return 'No tienes silenciador';
    }

    // El arma en las manos se rompe: la cuerpo a cuerpo desaparece; la de fuego queda rota
    breakCurrent() {
      if (this.cur < 0) return;
      const s = this.hands[this.cur];
      if (G.Weapons.isGun(G.Weapons.get(s.id))) { s.broken = true; s.cond = 0; return; }
      this.hands[this.cur] = null;
      this.prev = -1;
      this.equip(-1);
    }

    // Datos de la cobertura para la pose: lado de la pared (1 = a la izquierda), asomarse, apuntar
    coverPose() {
      const cv = this.cover;
      if (!cv && this.coverAmt < 0.02) return null;
      const p = this._cp || (this._cp = {});
      p.amt = this.coverAmt;
      if (cv) {
        const lx = Math.cos(this.facing), lz = -Math.sin(this.facing);
        p.wall = (-cv.nx * lx - cv.nz * lz) >= 0 ? 1 : -1;
        p.peek = cv.corner && this.moveAmt < 0.3 ? 1 : 0;
        p.low = cv.low;
        p.aim = this.aiming ? 1 : 0;
      }
      return p;
    }

    // ---------- Daño y curación ----------
    damage(amount, cause) {
      this.health = Math.max(0, this.health - amount);
      this.hurt = 0.4;
      if (this.health <= 0 && !this.dead) { this.die(cause || 'Te mataron los infectados.'); return; }
      // un golpe corta el vendaje o el crafteo a medias
      if (this.action && (this.action.kind === 'bandage' || this.action.kind === 'pack')) this.action = null;
    }

    // Modo arcade: sin infección ni sangrado. Las heridas solo quitan vida
    wound(type) {
      this.wounds++;
      this.damage(type === 'rasguño' ? 4 : type === 'laceración' ? 9 : 14);
    }
    infect() { /* sin infección en este modo */ }

    get bleeding() { return false; }
    get needsCare() { return false; }

    // Vendarse (un tipo de venda): unos 2 s, quieta; recupera BANDAGE_HEAL de vida en pocos segundos
    startBandage(kind) {
      kind = 'venda';
      if (this.busy() || this.dead) return 'Ahora no puedes';
      if (!this.items.venda) return 'No tienes vendas';
      if (this.health + this.heal >= 99) return 'No lo necesitas';
      if (this.stance === 'prone') this.stance = 'crouch';
      this.action = { kind: 'bandage', item: kind, t: 0, dur: 2.0, impact: 0.92, face: this.facing, done: false };
      return null;
    }
    // Fabricar una venda: 2 botellas de alcohol + 1 trapo (desde la mochila o los bolsillos)
    craft(recipe) {
      if (recipe === 'molotov') {
        // molotov: la botella para lanzar + 1 botella de alcohol (y un trozo de trapo... o de la remera)
        if (this.throwable !== 'botella') return 'Necesitas una botella para lanzar';
        if (this.items.alcohol < 1) return 'Te falta alcohol';
        this.items.alcohol--; this.throwable = 'molotov';
        this.refreshModel();
        return null;
      }
      if (recipe !== 'venda') return 'Receta desconocida';
      if (this.items.alcohol < 2 || this.items.trapo < 1) return 'Te faltan materiales';
      if (this.itemRoom('venda') <= 0) return 'No te caben más vendas';
      this.items.alcohol -= 2; this.items.trapo--; this.items.venda++;
      return null;
    }
    finishBandage() {
      if (!this.items.venda) return null;
      this.items.venda--;
      this.heal += BANDAGE_HEAL;
      return 'Te vendaste: recuperas vida';
    }

    // Registrar un mueble: agachado si es bajo, de pie si es alto
    startSearch(f) {
      if (this.busy() || this.dead) return;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      const low = f.h < 1.0 && !G.Furniture.T[f.type].vehicle;
      this.action = { kind: 'search', t: 0, dur: low ? 1.35 : 1.15, impact: 0.82, face: Math.atan2(cx - this.pos.x, cz - this.pos.z), target: f, low, done: false };
      if (this.stance === 'prone') this.stance = 'crouch';
      G.World.emit(this.pos.x, this.pos.z, 1.5 * this.noiseMul, this.lv);
    }

    // Saltito (botón Saltar cuando no hay nada que trepar)
    jump() {
      if (this.busy() || this.hop || this.dead) return;
      if (this.stance !== 'stand') { this.setStance('stand'); return; }
      this.hop = { t: 0 };
    }

    // ---------- Actualización ----------
    update(dt, input, cam) {
      if (this.dead) return;
      const f = cam.forward(), r = cam.right();
      const mx = input.move.x, my = input.move.y;
      const mag = Math.min(1, Math.hypot(mx, my));
      // tras el ataque en carrera sigue corriendo en cuanto lo aparta (si empujas el joystick)
      if (this.action && this.action.kind === 'runKill' && this.action.t > 0.86 && mag > 0.3) this.action = null;
      const wantsMove = mag > 0.12 && !this.climb && !this.dodging && !this.struggle && !(this.action && (this.action.kind === 'finisher' || this.action.exec));

      const held = !!this.struggle || !!(this.action && this.action.exec);    // forcejeando o rematando
      if (input.crouch && !held) this.toggleCrouch();
      if (input.prone && !held) this.toggleProne();
      if (this.prone && this.aiming) this.aiming = false;
      const aimIn = !!input.aim;
      if (aimIn && !this._aimPrev) {
        this.reloadNoAim = false;
        // con un arma cuerpo a cuerpo (o la navaja) no se apunta: desenfunde rápido del último arma de fuego
        if (!G.Weapons.isGun(this.weapon) && !this.holdingThr) this.wantDraw = true;
      }
      if (!aimIn) this.wantDraw = false;
      if (this.wantDraw && !this.busy() && !held) {
        this.wantDraw = false;
        const gi = this.gunSlot();
        if (gi >= 0) this.equip(gi);
        else {
          if (G.Combat && G.Combat.msg) G.Combat.msg('No tienes armas de fuego', 'warn');
          if (G.Input && G.Input.setAim) G.Input.setAim(false);
        }
      }
      this._aimPrev = aimIn;
      if (!(this.gun && this.gun.reload)) this.reloadNoAim = false;
      this.aiming = aimIn && (G.Weapons.isGun(this.weapon) || this.holdingThr) && !this.reloadNoAim && !this.climb && !this.prone && !held;
      if (!this.aiming || !this.weapon.scope) this.scope = false;

      // correr te levanta del suelo; agachado, corres agachado (más rápido que caminar, menos ruido que de pie)
      if (wantsMove && input.run && this.stance === 'prone' && this.stamina > 0.1) this.stance = 'stand';
      const canRun = this.stamina > 0.04 && !this.action && this.stance !== 'prone' && this.proneAmt < 0.2;
      this.running = wantsMove && input.run && canRun;
      this.crouchRun = this.running && this.stance === 'crouch';

      // dirección en el mundo relativa a la cámara (en cualquier dirección: omni)
      let wx = f.x * -my + r.x * mx;
      let wz = f.z * -my + r.z * mx;
      const wl = Math.hypot(wx, wz) || 1;
      wx /= wl; wz /= wl;

      let speed;
      if (this.prone || this.proneAmt > 0.5) speed = PRONE_WALK;
      else if (this.running) speed = this.crouchRun ? CROUCH_RUN : (this.aiming ? AIM_RUN : RUN);
      else if (this.aiming) speed = AIM_WALK;
      else if (this.crouching) speed = CROUCH_WALK;
      else speed = WALK;
      // de espaldas se camina un poco más despacio
      if (!this.running && wantsMove && Math.abs(U.angleDiff(Math.atan2(wx, wz), Math.atan2(f.x, f.z))) > 1.75) speed *= 0.8;
      if (this.action) {
        const ak0 = this.action.kind;
        speed *= (ak0 === 'grab' || ak0 === 'search' || ak0 === 'bandage' || ak0 === 'pack' || ak0 === 'shoveoff' || this.action.exec) ? 0
          : ((ak0 === 'stomp' || ak0 === 'floor') ? 0.1 : ((ak0 === 'throw' || ak0 === 'pickup' || ak0 === 'pickupHi') ? 0.45 : 0.35));
      }
      if (this.blow && this.blow.t < 0.6) speed *= 0.3;
      // con el arco tenso se camina más despacio
      if (this.gun.draw > 0.3) speed *= 0.8;
      speed *= wantsMove ? mag : 0;
      // cuesta arriba se va más despacio (cuanto más empinada, más)
      if (speed > 0 && !this.lv) {
        const g0 = G.World.groundY(this.pos.x, this.pos.z, 0);
        const grade = (G.World.groundY(this.pos.x + wx * 0.6, this.pos.z + wz * 0.6, 0) - g0) / 0.6;
        if (grade > 0.08) speed *= Math.max(0.5, 1 - (grade - 0.08) * 1.2);
      }

      // cobertura: agachado junto a una pared o valla te pegas a ella y te mueves de costado
      this.updateCover(dt, wantsMove ? wx : 0, wantsMove ? wz : 0, f);
      const cv = this.cover;
      let tvx = wx * speed, tvz = wz * speed;
      if (cv) {
        // sin alejarse de la pared: solo el movimiento a lo largo, y un leve tirón hasta pegarse
        let along = tvx * cv.tx + tvz * cv.tz;
        // al llegar a la esquina se queda asomado; si sigues empujando un momento, sale
        if (cv.corner && along * cv.side > 0 && cv.endDist < 0.3) {
          cv.pushT += dt;
          if (cv.pushT < 0.5) along = 0;
        } else cv.pushT = 0;
        const pull = (cv.d - 0.34) * -2.5;
        tvx = cv.tx * along + cv.nx * pull;
        tvz = cv.tz * along + cv.nz * pull;
      }

      // inercia: acelera y frena en unas décimas de segundo
      const k = 1 - Math.exp(-dt * (speed > 0.01 ? ACCEL : DECEL));
      this.vel.x += (tvx - this.vel.x) * k;
      this.vel.z += (tvz - this.vel.z) * k;

      if (this.climb) {
        this.updateClimb(dt);
        this.vel.x = this.vel.z = 0;
      } else if (this.dodging) {
        // esquiva: unos 1,6 m que arrancan rápido y frenan al final
        const d = this.dodging;
        const t0 = Math.min(1, d.t);
        d.t += dt / d.dur;
        const t1 = Math.min(1, d.t);
        const ease = (t) => 1 - (1 - t) * (1 - t);
        const step = (ease(t1) - ease(t0)) * DODGE_DIST;
        G.World.move(this.pos, d.dx * step, d.dz * step, RADIUS, this.lv);
        const v = step / Math.max(dt, 1e-4);
        this.vel.x = d.dx * v * 0.3; this.vel.z = d.dz * v * 0.3;
        if (d.t >= 1) { this.dodging = null; this.dodgeAfter = 0.3; }
      } else if (this.action && this.action.kind === 'finisher' && this.action.goto) {
        // el remate te coloca junto al zombi caído
        const g = this.action.goto;
        const kk = Math.min(1, dt * 9);
        G.World.move(this.pos, (g.x - this.pos.x) * kk, (g.z - this.pos.z) * kk, RADIUS, this.lv);
        this.vel.x = this.vel.z = 0;
      } else {
        G.World.move(this.pos, this.vel.x * dt, this.vel.z * dt, RADIUS, this.lv);
        // retroceso por un golpe recibido
        if (this.blowKb) {
          const k = this.blowKb;
          G.World.move(this.pos, k.x * dt, k.z * dt, RADIUS, this.lv);
          const fk = Math.max(0, 1 - dt * 6); k.x *= fk; k.z *= fk;
          if (Math.abs(k.x) + Math.abs(k.z) < 0.02) this.blowKb = null;
        }
        // paso adelante al golpear (si el zombi está algo lejos)
        const st = this.action && this.action.step;
        if (st) {
          const fr = U.smooth(U.clamp((this.action.t - 0.1) / 0.35, 0, 1)) * st.len;
          const dd = fr - st.done;
          if (dd > 0) {
            G.World.move(this.pos, Math.sin(this.action.face) * dd, Math.cos(this.action.face) * dd, RADIUS, this.lv);
            st.done = fr;
          }
        }
      }

      // pelea: tiempo desde el último golpe cuerpo a cuerpo (la cámara se pega y, sin arma, se levanta la guardia)
      const ak = this.action && this.action.kind;
      if (ak && MELEE_KINDS[ak]) this.fightT = 0; else this.fightT = (this.fightT == null ? 99 : this.fightT) + dt;
      const guardOn = this.weapon.cat === 'none' && this.fightT < 2.4 && !this.running && !this.prone && this.crouchAmt < 0.35 && !this.climb;
      this.guardAmt = (this.guardAmt || 0) + ((guardOn ? 1 : 0) - (this.guardAmt || 0)) * Math.min(1, dt * 8);

      const vlen = Math.hypot(this.vel.x, this.vel.z);
      const moveYaw = Math.atan2(this.vel.x, this.vel.z);
      const camYaw = Math.atan2(f.x, f.z);
      // orientación: al apuntar o atacar el cuerpo mira a la cámara y las piernas van a cualquier lado;
      // si no, el cuerpo gira hacia donde te mueves
      if (this.climb || this.dodging) { /* la fija updateClimb; al esquivar se mantiene */ }
      else if (this.struggle) {
        // forcejeando: de cara al infectado que te tiene agarrada
        const z = this.struggle.z;
        this.facing = U.turnToward(this.facing, Math.atan2(z.pos.x - this.pos.x, z.pos.z - this.pos.z), 14 * dt);
      } else if (this.cover && !this.action && !this.aiming) {
        // pegado a la pared: mira a lo largo de ella, hacia donde vas o hacia donde mira la cámara
        this.facing = U.turnToward(this.facing, Math.atan2(this.cover.tx * this.cover.side, this.cover.tz * this.cover.side), 10 * dt);
      } else if (this.action) {
        this.facing = U.turnToward(this.facing, this.action.face != null ? this.action.face : camYaw, 14 * dt);
      } else if (this.aiming) {
        this.facing = U.turnToward(this.facing, camYaw, 14 * dt);
      } else if (vlen > 0.2) {
        // Caminando hacia atrás (respecto a la cámara) el personaje no se gira: camina de espaldas.
        // Hacia delante o a los lados gira hacia donde va. Corriendo siempre mira hacia donde corre.
        let want = moveYaw;
        const back = Math.abs(U.angleDiff(moveYaw, camYaw)) > 1.75;
        if (back && !this.running && !this.prone) want = moveYaw + Math.PI;
        this.facing = U.turnToward(this.facing, want, (this.prone ? 3 : (this.running ? 9 : 10)) * dt);
      }
      this.moveRel = vlen > 0.2 ? U.angleDiff(moveYaw, this.facing) : 0;

      if (this.dodgeAfter > 0) this.dodgeAfter -= dt;
      // pruebas de desarrollador: munición sin fin
      if (G.DEV) for (const a in this.ammo) { const cap = this.ammoCap(a); if (this.ammo[a] < cap) this.ammo[a] = cap; }
      if (this.blow) { this.blow.t += dt / this.blow.dur; if (this.blow.t >= 1) this.blow = null; }
      // resistencia

      // ruido (en la hierba alta, al moverte de pie o agachado, se oye un leve roce)
      const moving = vlen > 0.3;
      this.inGrass = G.World.tallAt ? G.World.tallAt(this.pos.x, this.pos.z, this.lv) : false;
      if (this.crouchRun) { this.noise = NOISE_CROUCH_RUN + (this.inGrass ? 1 : 0); this.noiseLevel = 1; }
      else if (this.running) { this.noise = NOISE_RUN; this.noiseLevel = 2; }
      else if (moving && this.stance === 'stand') { this.noise = (vlen > 2.4 ? 3.5 : NOISE_WALK) + (this.inGrass ? 1 : 0); this.noiseLevel = 1; }
      else if (this.prone) { this.noise = 0; this.noiseLevel = this.inGrass ? 5 : 4; }
      else if (this.crouching) { this.noise = moving && this.inGrass ? 1.2 : 0; this.noiseLevel = this.inGrass ? 5 : 3; }
      else { this.noise = 0; this.noiseLevel = 0; }

      // heridas: el sangrado dura un rato si no te vendas
      if (this.heal > 0) {
        // venda: la vida sube en unos segundos
        const h = Math.min(this.heal, 14 * dt);
        this.heal -= h; this.health = Math.min(100, this.health + h);
        if (this.health >= 100) this.heal = 0;
      } else if (this.health < 50 && this.health > 0) {
        // sin tratamiento la vida solo vuelve sola hasta la mitad, despacio
        this.health = Math.min(50, this.health + 0.15 * dt);
      }
      this.hurt = Math.max(0, this.hurt - dt);

      // salto
      if (this.hop) {
        this.hop.t += dt / 0.5;
        this.hopLift = Math.sin(Math.PI * Math.min(1, this.hop.t)) * 0.32;
        if (this.hop.t >= 1) { this.hop = null; this.hopLift = 0; }
      }

      const ref = this.prone ? PRONE_WALK : REF_AMT;
      this.moveAmt += (Math.min(1, vlen / ref) - this.moveAmt) * Math.min(1, dt * 12);
      this.speedNow = vlen;
      // metros que llevas corriendo sin parar (el ataque en carrera necesita impulso)
      this.runDist = this.running && vlen > 2 ? (this.runDist || 0) + vlen * dt : 0;
      this.life(dt, vlen);
      this.time = (this.time || 0) + dt;
      // pasos por segundo según la velocidad (de paseo a carrera a fondo)
      const rate = this.prone ? 5 : Math.PI * 2 * (0.62 + 0.21 * Math.min(6, vlen));
      this.phase += dt * rate * (this.moveAmt > 0.05 ? 1 : 0);
      const finisher = this.action && this.action.kind === 'finisher';
      const coverRise = this.cover && this.cover.low && this.aiming ? 0.45 : 1;
      this.crouchAmt += ((this.crouching && !this.climb && !finisher ? coverRise * (this.crouchRun ? 0.55 : 1) : 0) - this.crouchAmt) * Math.min(1, dt * 9);
      this.proneAmt += ((this.prone && !this.climb ? 1 : 0) - this.proneAmt) * Math.min(1, dt * 5);
      // en la escalera se cambia de planta a mitad de camino
      this.lv = G.World.levelAt(this.pos.x, this.pos.z, this.lv);
      const gy = G.World.groundY(this.pos.x, this.pos.z, this.lv);
      this.y += (gy - this.y) * Math.min(1, dt * (G.World.stairAt(this.pos.x, this.pos.z) ? 20 : 12));
      if (this.health <= 0 && !this.dead) this.die('Te mataron los infectados.');
    }

    // ---------- Cobertura ----------
    updateCover(dt, mx, mz, camF) {
      // desactivada de momento (trababa al personaje); el código queda para retomarla
      if (!COVER_ON) { this.cover = null; this.coverAmt = 0; return; }
      const W = G.World;
      const ok = this.stance === 'crouch' && !this.climb && !this.dodging && !this.running && !this.dead &&
        !(this.action && (this.action.kind === 'search' || this.action.kind === 'pack' || this.action.kind === 'finisher' || this.action.kind === 'grab'));
      let cv = this.cover;
      if (!ok) cv = null;
      else {
        const near = W.coverNear(this.pos.x, this.pos.z, this.lv, cv ? 0.75 : 0.55);
        if (!near) cv = null;
        else {
          // alejarse de la pared con el joystick te despega
          const away = mx * near.nx + mz * near.nz;
          if (cv && away > 0.6) cv = null;
          else if (!cv && away > 0.2) cv = null;
          else {
            const prev = cv;
            cv = near;
            // hacia qué lado miras a lo largo de la pared: el de tu movimiento o el de la cámara
            const along = mx * near.tx + mz * near.tz;
            const camA = camF.x * near.tx + camF.z * near.tz;
            cv.side = Math.abs(along) > 0.2 ? Math.sign(along) : (prev && prev.o === near.o ? prev.side : (camA >= 0 ? 1 : -1));
            // esquina: la pared se acaba a menos de medio metro hacia ese lado
            const s = near.o === 'N' ? near.cx : near.cz;
            cv.corner = !W.coverAlong(near, s + cv.side * 0.45, this.lv);
            cv.endDist = cv.corner ? Math.abs((cv.side > 0 ? Math.floor(s + 0.45) : Math.ceil(s - 0.45)) - s) : 9;
            cv.pushT = prev ? prev.pushT || 0 : 0;
          }
        }
      }
      this.cover = cv;
      this.coverAmt += ((cv ? 1 : 0) - this.coverAmt) * Math.min(1, dt * 8);
    }

    // Estado del arma de fuego para la animación
    gunPose(w) {
      const g = this.gun, gp = this._gp || (this._gp = {});
      gp.kind = w.gun; gp.aim = g.aim; gp.recoil = g.recoil;
      gp.cycle = g.cycle ? Math.min(1, g.cycle.t) : -1;
      gp.rw = g.rw || 0; gp.ru = g.ru || 0; gp.draw = g.draw; gp.arrow = !!g.arrow;
      return gp;
    }

    // Saltar por una ventana abierta o una valla
    startClimb(ref, kind) {
      const W = G.World;
      if (this.stance !== 'stand') this.stance = 'stand';
      const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x;
      const mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
      const nx = ref.o === 'N' ? 0 : 1, nz = ref.o === 'N' ? 1 : 0;
      const side = (this.pos.x - mx) * nx + (this.pos.z - mz) * nz > 0 ? 1 : -1;
      const tx = mx - nx * side * 0.6, tz = mz - nz * side * 0.6;
      if (W.circleBlocked(tx, tz, RADIUS, this.lv)) return false;
      this.climb = {
        x0: this.pos.x, z0: this.pos.z, x1: tx, z1: tz, t: 0,
        dur: kind === 'fence' ? 0.85 : 1.2, h: kind === 'fence' ? 0.7 : 0.95,
        face: Math.atan2(-nx * side, -nz * side)
      };
      this.action = null;
      return true;
    }

    updateClimb(dt) {
      const c = this.climb;
      c.t += dt / c.dur;
      const t = Math.min(1, c.t);
      this.pos.x = U.lerp(c.x0, c.x1, U.smooth(t));
      this.pos.z = U.lerp(c.z0, c.z1, U.smooth(t));
      this.facing = U.turnToward(this.facing, c.face, 12 * dt);
      this.climbLift = Math.sin(Math.PI * t) * c.h;
      if (c.t >= 1) { this.climb = null; this.climbLift = 0; }
    }

    die(cause) {
      this.dead = true;
      this.deathCause = cause;
      this.deathT = 0;
      this.action = null;
      this.climb = null;
    }

    // Pose y posición del modelo
    apply(dt) {
      const m = this.model;
      // apuntando en la esquina de una pared alta, el personaje sale de lado para disparar
      const cv = this.cover;
      const out = cv && !cv.low && cv.corner && this.aiming ? 0.42 : 0;
      this.aimOut = this.aimOut || { x: 0, z: 0 };
      const kk = Math.min(1, (dt || 0.016) * 10);
      this.aimOut.x += ((cv ? cv.tx * cv.side * out : 0) - this.aimOut.x) * kk;
      this.aimOut.z += ((cv ? cv.tz * cv.side * out : 0) - this.aimOut.z) * kk;
      m.root.position.set(this.pos.x + this.aimOut.x, this.y + (this.climbLift || 0) + (this.hopLift || 0), this.pos.z + this.aimOut.z);
      m.root.rotation.y = this.facing;
      if (this.dead) {
        this.deathT = Math.min(1, (this.deathT || 0) + (dt || 0) * 1.6);
        G.Models.poseZombie(m, { phase: 0, amt: 0, chase: false, armsUp: 0, reach: 0, stagger: 0, seed: 0, lean: 0, tilt: 0, dt });
        G.Models.poseFall(m, this.deathT, 1);
        return;
      }
      let a = this.action;
      // forcejeo, remates, lanzar y recoger: con un arma de fuego en la mano se guarda y sale la navaja
      const kl = !!(this.struggle || (a && (a.knifeSwap || a.kind === 'throw' || a.kind === 'pickup' || a.kind === 'pickupHi' || a.kind === 'shoveoff')));
      const gunHeld = G.Weapons.isGun(this.weapon) || !!(a && a.knifeSwap && !this.weapon.knife);
      const w = kl && gunHeld ? G.Weapons.KNIFE : this.weapon;
      // ladrillo o botella en la mano mientras lo lanza (después vuelve la navaja o el arma)
      let show = null;
      if (a && a.kind === 'throw' && a.t < (a.impact || 0.46)) show = a.item;
      else if (kl && gunHeld) show = 'navaja';
      else if (this.holdingThr && a && a.kind !== 'throw' && a.kind !== 'pickup' && a.kind !== 'pickupHi') show = 'navaja';
      if (show) G.Models.setWeapon(m, show);
      else if (this._thrShown) this.refreshModel();
      this._thrShown = !!show;
      if (a && a.kind === 'pack') a = { kind: 'search', t: 0.3 + ((this.time || 0) * 0.07) % 0.45, low: true };
      G.Models.posePlayer(m, {
        phase: this.phase, amt: this.moveAmt, run: this.running, crouch: this.crouchAmt, prone: this.proneAmt,
        rel: this.moveRel, hop: this.hop ? Math.min(1, this.hop.t) : 0,
        cat: w.cat, two: kl && gunHeld ? false : this.twoHanded, aim: this.aiming || !!a, dt, time: this.time || 0,
        action: a ? a.kind : null, t: a ? Math.min(1, a.t) : 0,
        climb: this.climb ? Math.min(1, this.climb.t) : null,
        dodge: this.dodging ? Math.min(1, this.dodging.t) : null, dodgeRel: this.dodging ? this.dodging.rel : 0,
        gun: G.Weapons.isGun(w) ? this.gunPose(w) : null,
        pitch: G.Camera ? G.Camera.pitch + (G.Camera.kickOff || 0) - 0.14 : 0,
        grabKnife: !!(a && a.kind === 'grab' && a.knife),
        searchLow: !!(a && a.kind === 'search' && a.low),
        side: a && a.side ? a.side : 1,
        weaponCat: w.cat,
        guard: this.guardAmt || 0,
        speed: this.speedNow || 0, female: this.female,
        turn: this.lf ? this.lf.turn : 0, acc: this.lf ? this.lf.acc : 0,
        breath: this.lf ? this.lf.breath : 0, breathT: this.lf ? this.lf.bt : 0,
        look: this.lf ? this.lf.look : null, alert: this.lf ? this.lf.alert : 0, fidget: this.lf ? this.lf.fid : null,
        blow: this.blow ? { t: Math.min(1, this.blow.t), rel: this.blow.rel, bite: this.blow.bite, dur: this.blow.dur, react: this.blow.react, fl: this.blow.fl } : null,
        struggle: this.struggle ? { t: this.struggle.t, prog: this.struggle.prog } : null,
        cover: this.coverPose()
      });
    }
  }

  G.Player = Player;
})(window.Game = window.Game || {});

(function (G) {
  'use strict';

  const U = G.Util;

  // Zombis lentos. Ajusta estos valores para cambiar la dificultad.
  const SIGHT_RANGE = 16;
  const CROUCH_SIGHT = 6;        // a un jugador agachado solo lo ven hasta esta distancia
  const PRONE_SIGHT = 3.5;       // tumbado, aún más cerca
  const NOTICE_TIME = 0.75;      // segundos que tienen que mirarte para notarte agachado
  // De pie también tardan un poco en reconocerte (de cerca casi nada, de lejos más): mientras tanto se
  // paran, te miran y se acercan despacio. Si te escondes antes, van a investigar donde te vieron, muy lento
  const NOTICE_STAND = [0.35, 1.25];   // segundos de cerca y en el límite de la vista
  const SUS_SPEED = 0.35;              // acercándose mientras te reconoce
  const SEARCH_SPEED = 0.7;            // investigando (a trompicones, se para y sigue)
  const HUNTER_SEARCH = 1.5;           // los de las oleadas saben más o menos dónde estás: van más decididos
  const FOV_HALF = 0.8;          // solo ven de frente (~92°)
  const WANDER_SPEED = 0.5;
  const INVESTIGATE_SPEED = 0.8;
  const CHASE_SPEED = 1.3;       // algo más lentos que el jugador caminando
  const REACH = 1.05;            // distancia a la que intentan agarrarte
  // Golpes (los puñetazos que antes daba el protagonista): gancho de derecha, gancho de izquierda y golpe
  // fuerte. imp: momento del golpe (fracción de la duración). Si el primero falla, el combo se corta
  const COMBO = [{ kind: 'punch1', dur: 0.72, imp: 0.42 }, { kind: 'punch2', dur: 0.62, imp: 0.42 }, { kind: 'punch3', dur: 1.05, imp: 0.52 }];
  // Fuego (molotov): se queman unos segundos y van perdiendo vida; los alcanzados se quedan un rato
  // sacudiéndose las llamas y el más cercano al impacto cae al suelo, se revuelca y muere
  const BURN_T = 6, BURN_DPS = 0.42, BURN_STUN = [2.4, 3.6], BURN_ROLL = 3.2;
  const BEAT_REST = 0.9;         // respiro tras un combo antes de que otro te pueda pegar
  const GRAB_P = 0.2;            // probabilidad de que un ataque sea un intento de agarre (si no, el combo)
  // Golpe en carrera (el ataque en carrera que tenía el protagonista): el corredor se lanza desde 2 a 3,6 m
  const RUNATK = { dur: 0.8, imp: 0.42, min: 2.0, max: 3.6, chance: 0.5, cd: 4 };
  const WINDUP = 0.62;           // preparación del ataque: corta pero se ve venir, se puede esquivar
  const RADIUS = 0.28;
  const HP_MIN = 2.4, HP_MAX = 3.4;   // vida de cada zombi
  const NO_FALL = true;              // los golpes no los tiran al suelo (solo caen al morir)
  // Reacciones a los golpes: duración (s), fuerza del empuje (m/s al empezar) y cuánto va de lado
  const REACT = {
    side: { dur: 0.75, force: 2.6, lat: 0.55 },     // gancho o golpe horizontal: la cabeza y el torso se van de lado
    heavy: { dur: 1.0, force: 4.4, lat: 0.15 },     // golpe fuerte de frente: se echa atrás con los brazos arriba
    vert: { dur: 0.85, force: 1.3, lat: 0 },        // de arriba abajo: se le doblan las rodillas
    stab: { dur: 0.7, force: 1.4, lat: 0 },         // puñalada: se encorva
    push: { dur: 0.6, force: 3.0, lat: 0 },         // culatazo o golpe con el arma de fuego
    shot: { dur: 0.5, force: 1.6, lat: 0.2 },       // disparo
    wall: { dur: 0.9, force: 0, lat: 0 }            // se estampó contra una pared
  };
  // Corredores: una parte de los zombis es agresiva (ven más lejos, te notan antes,
  // corren casi como tú, chillan al verte y se lanzan a por ti). El resto, lentos.
  const RUNNER_CHANCE = 1;          // por ahora todos son corredores (ninguno camina lento)
  // muy agresivos: corren casi como tú, te ven de lejos y te notan enseguida, atacan rápido y se lanzan lejos
  const RUNNER = { chase: 4.0, sight: 30, notice: 0.18, windup: 0.32, reach: 1.45, lunge: 1.65, hp: [2.0, 2.8], scream: 18, wander: 1.0, investigate: 2.6 };

  // piel pálida y enfermiza, entre gris, verde y amarillo
  const SKINS = [0x9aa08a, 0xa3a690, 0x8c957f, 0xb0ad98, 0x9a9580, 0x87907c, 0xa59f8c];
  const SHIRTS = [0x5a4a3a, 0x6b5d4f, 0x4a5560, 0x6e4b4b, 0x55603f, 0x7a7a72, 0x3f4a5a, 0x8a7a5a, 0x5e3f3f, 0x9a9488];
  const PANTS = [0x2f3340, 0x3b3a33, 0x4a4036, 0x28303a, 0x3d4a5a, 0x5a5448];
  const HAIR = [0x2a2018, 0x3a2a1c, 0x5a4630, 0x1a1a1a, 0x7a6a5a, null, null];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  // estados en los que un ruido no le hace cambiar de idea
  const BUSY = { burning: 1, burnroll: 1, dead: 1, down: 1, rise: 1, stagger: 1, attack: 1, recover: 1, combo: 1, runatk: 1, climb: 1, chase: 1, bang: 1, grabbed: 1, alert: 1, stun: 1, grapple: 1, held: 1 };
  // Ciegos (variante dura): no ven, oyen muy bien, van encorvados y se lanzan hacia el ruido.
  // Aguantan más golpes (en la cabeza mueren igual) y su agarre es casi mortal
  const BLIND = { chase: 3.3, wander: 0.75, investigate: 1.7, hear: 1.7, touch: 1.25, hp: [4.6, 5.6], windup: 0.42, reach: 1.25 };

  function randomLook() {
    const fungus = Math.random() < 0.4 ? 0 : (Math.random() < 0.65 ? 1 : 2);
    return {
      fungus, facePlate: fungus === 2 && Math.random() < 0.6,
      belt: Math.random() < 0.4 ? 0x2e2620 : null, pocket: Math.random() < 0.5,
      skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR),
      longHair: Math.random() < 0.3, longSleeves: Math.random() < 0.4,
      shoes: pick([0x2a2622, 0x3b3029, 0x4a4a4a, 0x5a4636]),
      seed: Math.floor(Math.random() * 1e9), drag: Math.random() < 0.3,
      armsUp: Math.random() < 0.35 ? 0.6 : 0,
      runner: Math.random() < RUNNER_CHANCE,
      female: Math.random() < 0.35
    };
  }

  class Zombie {
    constructor(scene, x, z, look, facing, extra) {
      this.scene = scene;
      this.pos = { x, z };
      this.lv = (extra && extra.lv) || 0;
      this.y = G.World.groundY(x, z, this.lv);
      this.facing = facing != null ? facing : Math.random() * Math.PI * 2;
      this.look = look || randomLook();
      // variante ciega: cabeza cubierta de hongo, sin pelo, encorvada
      if (extra && extra.blind) Object.assign(this.look, { blind: true, runner: false, fungus: 2, facePlate: true, drag: false, armsUp: 0, hair: null, longHair: false });
      this.blind = !!this.look.blind;
      // los de las oleadas saben siempre dónde estás (te cazan)
      this.hunter = !!(extra && extra.hunter);
      // los corredores: menos hongo y más sangre, no arrastran la pierna
      if (this.look.runner) { this.look.fungus = Math.min(this.look.fungus, 1); this.look.facePlate = false; this.look.drag = false; this.look.armsUp = 0; }
      this.runner = !!this.look.runner;
      this.model = G.Models.createHumanoid(Object.assign({ zombie: true, blood: U.mulberry32(this.look.seed) }, this.look));
      scene.add(this.model.root);
      this.hp = extra && extra.hp != null ? extra.hp
        : (this.blind ? BLIND.hp[0] + Math.random() * (BLIND.hp[1] - BLIND.hp[0])
          : (this.runner ? RUNNER.hp[0] + Math.random() * (RUNNER.hp[1] - RUNNER.hp[0]) : HP_MIN + Math.random() * (HP_MAX - HP_MIN)));
      this.state = 'idle';
      this.timer = 1 + Math.random() * 3;
      this.target = null;
      this.lastSeen = 0;
      this.hearTimer = 0;
      this.path = null; this.pathTimer = 0; this.clear = true; this.clearTimer = 0;
      this.stuck = 0;
      this.phase = Math.random() * 10;
      this.speedNow = 0;
      this.reach = 0;
      this.notice = 0;
      this.stagger = 0;
      this.kb = { x: 0, z: 0 };
      this.fall = 0;          // 0 de pie, 1 en el suelo
      this.fallDir = -1;
      this.edge = null;
      this.climbing = null;
      this.bangT = 0;
      this.resume = 'chase';
      this.tilt = (Math.random() - 0.5) * 1.6;
      this.lean = (Math.random() - 0.5) * 0.12;
      if (extra && extra.dead) { this.state = 'dead'; this.fall = 1; this.fallDir = extra.fallDir || -1; }
      // los que aparecen dentro de una casa no salen de su habitación hasta oír un ruido
      this.homebound = !!(extra && extra.homebound);
      if (this.homebound) { const r = G.World.roomAt(Math.floor(x), Math.floor(z), this.lv); this.homeRoom = r; if (!r) this.homebound = false; }
      this.apply(0);
    }

    get alive() { return this.state !== 'dead'; }
    get downed() { return this.state === 'down' || (this.state === 'rise' && this.timer > 0.6); }
    get standing() { return this.alive && !this.downed && this.state !== 'rise'; }

    dispose() {
      this.scene.remove(this.model.root);
      G.Models.disposeHumanoid(this.model);
    }

    enter(state, timer) {
      this.state = state;
      this.timer = timer || 0;
      this.exposed = false;
      this.pathTimer = 0;
      this.clearTimer = 0;
      this.stuck = 0;
    }

    // ---------- Agarre, aturdimiento y remates ----------
    // Te agarra (forcejeo): se queda pegado delante de ti hasta que te sueltas o te muerde
    startGrapple() { this.enter('grapple', 0); this.reach = 0; this.path = null; this.edge = null; this.grappleT = 0; this.kb.x = this.kb.z = 0; }
    // Aturdido: se tambalea con las manos en la cara; un golpe cuerpo a cuerpo lo remata
    stun(dur, dx, dz, force) {
      if (!this.alive || this.state === 'held') return;
      this.enter('stun', dur); this.stunDur = dur; this.stunT = 0; this.reach = 0; this.edge = null; this.path = null;
      if (dx != null) { const l = Math.hypot(dx, dz) || 1, f = force != null ? force : 1.5; this.kb.x = dx / l * f; this.kb.z = dz / l * f; }
    }
    get stunned() { return this.state === 'stun'; }
    // Lo están rematando: lo mueve quien lo remata
    hold(kind) { this.enter('held', 0); this.heldKind = kind; this.heldT = 0; this.reach = 0; this.path = null; this.edge = null; this.kb.x = this.kb.z = 0; }

    // Le alcanza el fuego. roll: el más cercano al impacto cae y se revuelca hasta morir
    ignite(player, roll) {
      if (!this.alive || this.state === 'held' || this.state === 'burnroll') return;
      this.burnT = Math.max(this.burnT || 0, BURN_T);
      if (G.Fire) G.Fire.attach(this);
      if (player) this.endCombo(player);
      this.reach = 0; this.path = null; this.edge = null; this.kb.x = this.kb.z = 0;
      if (roll) { this.fallDir = -1; this.rollT = 0; this.enter('burnroll', BURN_ROLL); }
      else if (this.state !== 'burning') this.enter('burning', BURN_STUN[0] + Math.random() * (BURN_STUN[1] - BURN_STUN[0]));
    }

    // Empieza el combo de puñetazos (o el golpe en carrera): te tiene "atrapada" (nadie más te pega)
    startCombo(player) {
      this.enter('combo', 0); this.combo = { step: 0, t: 0, hit: false, hits: 0 }; this.reach = 0;
      player.beaten = { z: this };
    }
    startRunAtk(player, dist) {
      // velocidad del impulso: llega a tu lado justo en el golpe
      const v = U.clamp(((dist || 3) - 0.85) / (RUNATK.imp * RUNATK.dur), 3, 8);
      this.enter('runatk', 0); this.combo = { step: 'run', t: 0, hit: false, hits: 0, v }; this.reach = 0;
      player.beaten = { z: this };
    }
    endCombo(player) {
      if (player && player.beaten && player.beaten.z === this) { player.beaten = null; player.beatCD = BEAT_REST; }
    }

    aware() {
      return this.state === 'chase' || this.state === 'attack' || this.state === 'recover' || this.state === 'alert' || this.state === 'combo' || this.state === 'runatk';
    }

    // Un ruido en (x, z) con alcance r
    hear(x, z, r, lv) {
      if (BUSY[this.state]) return;
      lv = lv || 0;
      const other = lv !== (this.lv || 0);
      if (other) r *= 0.55;                      // de otra planta se oye peor
      const d = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (d > r) return;
      if (!other && d > r * 0.6 && !G.World.hasLOS(this.pos.x, this.pos.z, x, z, this.lv)) return;
      this.homebound = false;
      this.target = { x: x + (Math.random() - 0.5) * 2, z: z + (Math.random() - 0.5) * 2, lv };
      this.enter('investigate', 14);
    }

    // ---------- Golpes recibidos ----------
    // dx, dz: dirección del golpe (desde el atacante hacia el zombi)
    // kind: tipo de golpe para la reacción ('side' lateral, 'heavy' fuerte de frente, 'vert' de arriba,
    // 'stab' puñalada, 'push' empujón o culatazo, 'shot' disparo). side: +1 lo empuja hacia su derecha
    // part: 'head' (muerte en el acto) o el cuerpo (del cuello para abajo: daño normal)
    takeHit(dmg, knock, dx, dz, behind, side, kind, part) {
      if (!this.alive) return 'none';
      if (part === 'head') dmg = Math.max(dmg, 999);
      if (this.state === 'burnroll') { this.hp -= dmg; if (this.hp <= 0) { this.die(-1); this.fall = 1; return 'kill'; } return 'hit'; }
      this.hp -= dmg;
      this.flinch = side || (Math.random() < 0.5 ? 1 : -1);   // hacia qué lado se dobla al recibir el golpe
      // caer hacia donde lo empujan: de espaldas si le pegan de frente, boca abajo si es por detrás
      const dir = behind ? 1 : -1;
      if (this.hp <= 0) { this.kb.x = 0; this.kb.z = 0; this.push(dx, dz, this.flinch, kind, 0.6); this.die(dir); return 'kill'; }
      if (this.downed) return 'hit';
      // ya no se caen: un golpe que antes los tiraba ahora los hace retroceder más y tambalearse más rato
      const strong = Math.random() < knock + (behind ? 0.25 : 0);
      this.react(strong && (kind === 'side' || !kind) ? 'heavy' : (kind || 'side'), this.flinch, dx, dz);
      if (strong) { this.kb.x *= 1.35; this.kb.z *= 1.35; this.timer += 0.25; this.reactDur += 0.25; }
      return 'hit';
    }

    // Reacción a un golpe: retrocede trastabillando hacia donde lo empujan y el cuerpo acusa el golpe
    react(kind, side, dx, dz) {
      const R = REACT[kind] || REACT.side;
      this.reach = 0;
      this.edge = null;
      this.reactKind = kind;
      this.reactDur = R.dur * (0.9 + Math.random() * 0.2);
      this.push(dx, dz, side, kind, 1);
      this.enter('stagger', this.reactDur);
      this.stagger = 0.001;
    }

    // empuje del golpe: hacia atrás y algo de lado (en la dirección en que iba el golpe)
    push(dx, dz, side, kind, mul) {
      const R = REACT[kind] || REACT.side;
      const l = Math.hypot(dx, dz) || 1;
      const fx = dx / l, fz = dz / l;
      // lateral: la derecha del zombi es la izquierda de quien pega, que mira hacia (fx, fz)
      const lx = fz, lz = -fx;
      const f = R.force * (mul || 1);
      this.kb.x = (fx + lx * side * R.lat) * f; this.kb.z = (fz + lz * side * R.lat) * f;
      this.wallHit = false;
    }

    doStagger(dx, dz, force) {
      const l = Math.hypot(dx, dz) || 1;
      this.reactKind = 'push';
      this.reactDur = 0.55;
      this.kb.x = dx / l * force; this.kb.z = dz / l * force;
      this.reach = 0;
      this.edge = null;
      this.enter('stagger', 0.55);
      this.stagger = 0.001;
    }

    // extra: segundos de más en el suelo (el empujón añade 2)
    knockDown(dir, dx, dz, extra) {
      // ya no se caen al suelo: se tambalean hacia atrás
      if (NO_FALL) { this.react('heavy', this.flinch || 1, dx, dz); return; }
      const l = Math.hypot(dx, dz) || 1;
      this.kb.x = dx / l * 1.2; this.kb.z = dz / l * 1.2;
      this.fallDir = dir;
      this.reach = 0;
      this.edge = null;
      this.homebound = false;
      this.enter('down', 2.5 + Math.random() * 2 + (extra || 0));
    }

    // Agarrado por la espalda: se queda delante del jugador forcejeando hasta morir
    grab(player) {
      this.grabber = player;
      this.reach = 0;
      this.edge = null;
      this.path = null;
      this.homebound = false;
      this.enter('grabbed', 0);
    }

    release() {
      this.grabber = null;
      this.target = null;
      this.doStagger(Math.sin(this.facing), Math.cos(this.facing), 1.5);
    }

    die(dir) {
      this.fallDir = dir;
      this.reach = 0;
      this.edge = null;
      this.state = 'dead';
      this.timer = 0;
    }

    // ---------- IA ----------
    update(dt, player, all, combat) {
      // si lo interrumpen (le pegas, lo aturdes, muere...), deja de tenerte atrapada
      if (player.beaten && player.beaten.z === this && this.state !== 'combo' && this.state !== 'runatk') player.beaten = null;
      // quemándose: va perdiendo vida mientras le duran las llamas
      if (this.burnT > 0) {
        this.burnT -= dt;
        if (this.alive && this.state !== 'burnroll') {
          this.hp -= BURN_DPS * dt;
          if (this.hp <= 0) { this.killedBy = 'fire'; this.endCombo(player); this.die(Math.random() < 0.5 ? 1 : -1); }
        }
      }
      if (this.state === 'burning') {
        // se sacude las llamas dando tumbos, sin hacerte caso
        this.timer -= dt; this.burnWob = (this.burnWob || 0) + dt;
        this.facing += Math.sin(this.burnWob * 2.3 + (this.look.seed || 0)) * 2.2 * dt;
        const sp = 0.45 + 0.35 * Math.sin(this.burnWob * 3.1);
        G.World.move(this.pos, Math.sin(this.facing) * sp * dt, Math.cos(this.facing) * sp * dt, RADIUS, this.lv);
        this.speedNow = sp; this.phase += dt * 4;
        this.knockback(dt);
        if (this.timer <= 0) { this.enter('chase', 0); this.target = { x: player.pos.x, z: player.pos.z, lv: player.lv || 0 }; this.lastSeen = 0; }
        this.apply(dt);
        return;
      }
      if (this.state === 'burnroll') {
        // cae y se revuelca en el suelo; al final muere
        this.timer -= dt; this.rollT = (this.rollT || 0) + dt;
        this.fall = Math.min(1, this.fall + dt * 2.6);
        this.speedNow = 0;
        if (this.timer <= 0) { this.hp = 0; this.killedBy = 'fire'; this.die(-1); this.fall = 1; }
        this.apply(dt);
        return;
      }
      if (this.state === 'dead') {
        this.fall = Math.min(1, this.fall + dt * 2.2);
        this.knockback(dt);
        this.apply(dt);
        return;
      }
      const px = player.pos.x, pz = player.pos.z;
      const dx = px - this.pos.x, dz = pz - this.pos.z;
      const dist = Math.hypot(dx, dz);
      let speed = 0;
      const plv = player.lv || 0;
      const sameLv = plv === (this.lv || 0);

      // estados sin control
      if (this.state === 'grapple') {
        const st = player.struggle;
        if (!st || st.z !== this || player.dead) { this.enter('recover', 0.6); this.apply(dt); return; }
        // pegado delante de ella, empujando para morder
        const f = { x: Math.sin(player.facing), z: Math.cos(player.facing) };
        const tx = player.pos.x + f.x * 0.5, tz = player.pos.z + f.z * 0.5;
        const k = Math.min(1, dt * 12);
        this.pos.x += (tx - this.pos.x) * k; this.pos.z += (tz - this.pos.z) * k;
        this.facing = U.turnToward(this.facing, player.facing + Math.PI, 14 * dt);
        this.grappleT = st.t; this.speedNow = 0;
        this.apply(dt);
        return;
      }
      if (this.state === 'stun') {
        this.timer -= dt; this.stunT = (this.stunT || 0) + dt;
        this.knockback(dt);
        if (this.timer <= 0) { this.enter('chase', 0); this.target = { x: px, z: pz, lv: plv }; this.lastSeen = 0; }
        this.phase += dt * 1.5;
        this.apply(dt);
        return;
      }
      if (this.state === 'held') {
        const a = player.action;
        if (!a || a.target !== this || !a.exec || player.dead) { this.stun(0.8); this.apply(dt); return; }
        this.heldT = a.t; this.speedNow = 0;
        this.apply(dt);
        return;
      }
      if (this.state === 'grabbed') {
        const p = this.grabber, a = p && p.action;
        if (!p || p.dead || !a || a.kind !== 'grab' || a.target !== this) { this.release(); this.apply(dt); return; }
        const f = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
        const tx = p.pos.x + f.x * 0.36, tz = p.pos.z + f.z * 0.36;
        const k = Math.min(1, dt * 14);
        this.pos.x += (tx - this.pos.x) * k; this.pos.z += (tz - this.pos.z) * k;
        this.facing = U.turnToward(this.facing, p.facing, 12 * dt);
        this.grabT = Math.min(1, a.t);
        this.speedNow = 0;
        this.apply(dt);
        return;
      }
      if (this.state === 'stagger') {
        this.timer -= dt;
        this.stagger = 1 - this.timer / (this.reactDur || 0.55);
        this.knockback(dt);
        if (this.timer <= 0) { this.stagger = 0; this.enter(this.target ? 'chase' : 'idle', 0); }
        this.apply(dt);
        return;
      }
      if (this.state === 'down') {
        this.fall = Math.min(1, this.fall + dt * 2.5);
        this.knockback(dt);
        this.timer -= dt;
        if (this.timer <= 0) this.enter('rise', 1.3);
        this.apply(dt);
        return;
      }
      if (this.state === 'rise') {
        this.timer -= dt;
        this.fall = Math.max(0, this.timer / 1.3);
        if (this.timer <= 0) { this.fall = 0; this.enter('chase', 0); this.target = { x: px, z: pz, lv: plv }; }
        this.apply(dt);
        return;
      }
      if (this.state === 'climb') {
        const c = this.climbing;
        c.t += dt / c.dur;
        const t = Math.min(1, c.t);
        this.pos.x = U.lerp(c.x0, c.x1, U.smooth(t));
        this.pos.z = U.lerp(c.z0, c.z1, U.smooth(t));
        this.lift = Math.sin(Math.PI * t) * 0.6;
        if (c.t >= 1) { this.lift = 0; this.climbing = null; this.enter(this.resume, 14); this.path = null; }
        this.phase += dt * 3;
        this.apply(dt);
        return;
      }

      // ---- sentidos ----
      let sees = false;
      // si ya te persigue no te pierde por agacharte; si no, agachado te ve de más cerca y tarda en notarte
      const sneaky = (player.stealth || 0) > 0 && !this.aware();
      const R = this.runner;
      // en la hierba alta: tumbado solo te ven casi encima; agachado, bastante más cerca
      let grass = sneaky && player.inGrass ? (player.stealth === 2 ? 0.3 : 0.55) : 1;
      // agachado detrás de una valla o un muro bajo (en cobertura): desde el otro lado te ven mucho menos
      const cvr = player.cover;
      if (sneaky && cvr && cvr.low && (this.pos.x - px) * cvr.nx + (this.pos.z - pz) * cvr.nz < 0) grass = Math.min(grass, 0.35);
      const range = sneaky ? (player.stealth === 2 ? PRONE_SIGHT : CROUCH_SIGHT) * (R ? 1.2 : 1) * grass : (R ? RUNNER.sight : SIGHT_RANGE);
      if (dist < range && !player.dead) {
        const diff = Math.abs(U.angleDiff(Math.atan2(dx, dz), this.facing));
        if ((diff < FOV_HALF || (dist < 1.4 && diff < 1.6)) && sameLv && G.World.hasLOS(this.pos.x, this.pos.z, px, pz, this.lv)) sees = true;
        // una loma entre los dos tapa la vista (tumbado o agachado se tapa antes)
        if (sees && !this.lv && dist > 3) {
          const ph = player.y + (player.stealth === 2 ? 0.3 : (player.stealth === 1 ? 0.85 : 1.45));
          if (G.World.terrainBlocks(this.pos.x, this.pos.z, this.y + 1.6, px, pz, ph)) sees = false;
        }
      }
      if (this.blind) {
        // no ve: solo nota lo que toca. Oye tus pasos (más lejos que los demás) y cualquier ruido
        sees = !player.dead && dist < BLIND.touch && sameLv;
        if (!sees && player.noise > 0 && dist < player.noise * BLIND.hear && sameLv && this.hearTimer <= 0) {
          this.hearTimer = 0.35;
          this.target = { x: px, z: pz, lv: plv };
          if (this.state !== 'attack' && this.state !== 'recover' && this.state !== 'combo' && this.state !== 'runatk') { if (this.state !== 'chase') this.enter('chase', 0); this.lastSeen = 0; }
        }
      } else if (this.hunter && !player.dead && dist < 90 && !sees && !this.aware()) {
        // de una oleada: sabe más o menos dónde estás y va hacia allí, pero tiene que verte para lanzarse
        this.huntT = (this.huntT || 0) - dt;
        if (this.huntT <= 0 && (this.state === 'idle' || this.state === 'wander' || this.state === 'investigate')) {
          this.huntT = 2.5;
          const e = Math.min(3, dist * 0.2);
          this.target = { x: px + (Math.random() - 0.5) * e * 2, z: pz + (Math.random() - 0.5) * e * 2, lv: plv };
          this.enter('investigate', 8);
        }
      }
      // reconocerte lleva un momento (salvo pegado a ti o si ya te persigue)
      let susp = false;
      if (sees && !this.blind && !this.aware() && dist > 1.6) {
        if (sneaky) this.notice += dt * (1.6 - dist / range) / (NOTICE_TIME * (R ? RUNNER.notice : 1) * (player.stealth === 2 ? 1.5 : 1));
        else this.notice += dt / (U.lerp(NOTICE_STAND[0], NOTICE_STAND[1], Math.min(1, dist / range)) * (this.hunter ? 0.75 : 1));
        if (this.notice < 1) { sees = false; susp = true; this.susAt = { x: px, z: pz, lv: plv }; }
      } else if (!sees) this.notice = Math.max(0, this.notice - dt * 0.3);
      let hearsRun = false;
      if (!sees && player.noise > 0 && dist < player.noise) {
        hearsRun = dist < player.noise * 0.6 || (sameLv && G.World.hasLOS(this.pos.x, this.pos.z, px, pz, this.lv));
      }
      this.hearTimer -= dt;

      if (sees) {
        this.lastSeen = 0;
        this.homebound = false;
        this.target = { x: px, z: pz, lv: plv };
        if (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'recover' && this.state !== 'combo' && this.state !== 'runatk' && this.state !== 'bang' && this.state !== 'alert') {
          // el corredor se para un instante y chilla (avisa a los de alrededor) antes de lanzarse
          if (R && !this.screamed) { this.screamed = true; this.enter('alert', 0.35); G.World.emit(this.pos.x, this.pos.z, RUNNER.scream, this.lv); }
          else this.enter('chase', 0);
        }
      } else {
        this.lastSeen += dt;
        if (hearsRun && this.hearTimer <= 0 && this.state !== 'attack' && this.state !== 'recover' && this.state !== 'combo' && this.state !== 'runatk') {
          this.hearTimer = 1;
          this.homebound = false;
          this.target = { x: px + (Math.random() - 0.5) * 1.5, z: pz + (Math.random() - 0.5) * 1.5, lv: plv };
          if (this.state !== 'chase' && this.state !== 'bang') this.enter('investigate', 14);
        }
        if (this.state === 'chase' && this.lastSeen > 1.5) this.enter('investigate', 12);
      }
      // te está viendo pero aún no te reconoce: se para, te mira y se acerca despacio
      if (susp && (this.state === 'idle' || this.state === 'wander' || this.state === 'investigate')) { this.homebound = false; this.enter('sus', 0); }
      if (this.state === 'sus' && !susp) {
        // te escondiste a tiempo: va a mirar donde te vio
        this.target = this.susAt ? { x: this.susAt.x, z: this.susAt.z, lv: this.susAt.lv } : null;
        this.enter('investigate', 14);
      }

      this.reach = Math.max(0, this.reach - dt * 3);

      switch (this.state) {
        case 'idle':
          this.timer -= dt;
          if (this.timer <= 0) {
            if (this.homebound) {
              // dentro de casa: da unos pasos sin salir de su habitación
              const a = Math.random() * Math.PI * 2, d = 0.8 + Math.random() * 2;
              const tx = this.pos.x + Math.sin(a) * d, tz = this.pos.z + Math.cos(a) * d;
              if (G.World.roomAt(Math.floor(tx), Math.floor(tz), this.lv) === this.homeRoom && G.World.hasClearLine(this.pos.x, this.pos.z, tx, tz, this.lv)) {
                this.target = { x: tx, z: tz, lv: this.lv }; this.enter('wander', 6);
              } else this.timer = 1 + Math.random() * 2;
              break;
            }
            const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 6;
            const tx = this.pos.x + Math.sin(a) * d, tz = this.pos.z + Math.cos(a) * d;
            if (!G.World.solidObj(G.World.obj(Math.floor(tx), Math.floor(tz), this.lv)) && (!this.lv || G.World.isIndoor(Math.floor(tx), Math.floor(tz), 1))) { this.target = { x: tx, z: tz, lv: this.lv }; this.enter('wander', 12); }
            else this.timer = 1;
          }
          break;
        case 'wander':
        case 'investigate': {
          this.timer -= dt;
          const g = this.target;
          if (!g || this.timer <= 0 || (Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 0.7 && (g.lv || 0) === (this.lv || 0))) {
            this.target = null;
            this.enter('idle', 2 + Math.random() * 5);
          } else speed = this.blind ? (this.state === 'wander' ? BLIND.wander : BLIND.investigate)
            : (this.state === 'wander' ? (R ? RUNNER.wander : WANDER_SPEED)
              // investigando: lento y a trompicones (avanza, se frena, sigue)
              : (this.hunter ? HUNTER_SEARCH : SEARCH_SPEED) * (0.45 + 0.55 * Math.max(0, Math.sin((this.time || 0) * 1.6 + (this.seed || 0)))));
          break;
        }
        case 'sus':
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 2.5 * dt);
          this.target = this.susAt;
          speed = Math.abs(U.angleDiff(Math.atan2(dx, dz), this.facing)) < 0.6 ? SUS_SPEED : 0;
          break;
        case 'alert':
          this.timer -= dt;
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 6 * dt);
          if (this.timer <= 0) this.enter('chase', 0);
          break;
        case 'chase':
          if (player.dead) { this.enter('idle', 3); this.target = null; break; }
          // otro la tiene agarrada o le está pegando: espera a un par de metros, encarándola
          if (((player.struggle && player.struggle.z !== this) || (player.beaten && player.beaten.z !== this)) && dist < 2.2) {
            this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 5 * dt);
            break;
          }
          this.runAtkCD = Math.max(0, (this.runAtkCD || 0) - dt);
          // corriendo hacia ti a la distancia justa: a veces se lanza con el golpe en carrera
          if (R && !this.blind && sees && sameLv && this.runAtkCD <= 0 && dist > RUNATK.min && dist < RUNATK.max && (this.speedNow || 0) > 2.5 && !player.beaten && !player.struggle && !((player.beatCD || 0) > 0)) {
            this.runAtkCD = RUNATK.cd;
            if (Math.random() < RUNATK.chance) { this.startRunAtk(player, dist); break; }
          }
          if (dist < (this.blind ? BLIND.reach : (R ? RUNNER.reach : REACH)) && (sees || (this.blind && dist < 1.4)) && sameLv) {
            if (player.beaten || player.struggle || (player.beatCD || 0) > 0) { this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 5 * dt); break; }
            const toZ = Math.atan2(-dx, -dz), behind = Math.abs(U.angleDiff(toZ, player.facing)) > 1.9;
            if ((player.grabCD || 0) <= 0 && Math.random() < GRAB_P * (behind ? 1.6 : 1)) {
              this.enter('attack', this.blind ? BLIND.windup : (R ? RUNNER.windup : WINDUP));
              this.lungeT = R ? 0 : -1;
            } else this.startCombo(player);
          } else speed = this.blind ? BLIND.chase : (R ? RUNNER.chase : CHASE_SPEED);
          break;
        case 'combo': {
          // combo de puñetazos: se acerca un poco si te alejas y te encara
          const c = this.combo, K = COMBO[c.step];
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 5 * dt);
          if (dist > 0.8 && c.t < K.imp) {
            const st = Math.min(dist - 0.75, (c.step === 0 ? 1.2 : 2.2) * dt);
            G.World.move(this.pos, Math.sin(this.facing) * st, Math.cos(this.facing) * st, RADIUS, this.lv);
          }
          c.t += dt / K.dur;
          if (!c.hit && c.t >= K.imp) {
            c.hit = true;
            const r = combat ? combat.zombiePunch(this, player, Math.hypot(px - this.pos.x, pz - this.pos.z), c.step) : 'miss';
            if (r === 'hit') c.hits++;
            else {
              // falló (o lo esquivaste): se corta el combo; esquivado, se pasa de largo y queda vendido
              const over = r === 'dodge';
              this.overextended = false;
              this.endCombo(player);
              this.strikeT = 0; this.strikeHit = false;
              this.enter('recover', over ? 1.1 : 0.45);
              if (over) { this.stun(1.25, Math.sin(this.facing), Math.cos(this.facing), 1.2); this.exposed = true; if (G.Mode && G.Mode.stats) G.Mode.stats.stun++; }
              break;
            }
          }
          if (c.t >= 1) {
            if (c.step < 2) { c.step++; c.t = 0; c.hit = false; }
            else { this.endCombo(player); this.enter('recover', 0.6); this.strikeT = 0; this.strikeHit = false; }
          }
          break;
        }
        case 'runatk': {
          // golpe en carrera: se lanza hacia ti con el impulso y descarga de arriba abajo
          const c = this.combo;
          c.t += dt / RUNATK.dur;
          if (c.t < RUNATK.imp + 0.05) this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 3 * dt);
          const sp = c.t < RUNATK.imp ? c.v : Math.max(0, c.v * 0.5 * (1 - (c.t - RUNATK.imp) / 0.25));
          if (sp > 0 && dist > 0.75) G.World.move(this.pos, Math.sin(this.facing) * sp * dt, Math.cos(this.facing) * sp * dt, RADIUS, this.lv);
          this.speedNow = sp;
          if (!c.hit && c.t >= RUNATK.imp) {
            c.hit = true;
            const r = combat ? combat.zombiePunch(this, player, Math.hypot(px - this.pos.x, pz - this.pos.z), 'run') : 'miss';
            if (r === 'dodge') { this.endCombo(player); this.stun(1.4, Math.sin(this.facing), Math.cos(this.facing), 2.2); this.exposed = true; break; }
          }
          if (c.t >= 1) { this.endCombo(player); this.enter('recover', 0.5); this.strikeT = 0; this.strikeHit = false; }
          break;
        }
        case 'attack':
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 4 * dt);
          this.timer -= dt;
          const wu = this.blind ? BLIND.windup : (R ? RUNNER.windup : WINDUP);
          this.reach = Math.min(1, 1 - this.timer / wu + 0.15);
          this.atkU = Math.min(1, 1 - this.timer / wu);
          // embestida: al final de la preparación se lanza hacia delante con los brazos por delante
          if (!R && this.timer < 0.18 && dist > 0.62) {
            const st = Math.min(dist - 0.6, 0.4 * dt / 0.18);
            G.World.move(this.pos, Math.sin(this.facing) * st, Math.cos(this.facing) * st, RADIUS, this.lv);
          }
          // el corredor se abalanza hacia delante al final de la preparación
          if (R && this.timer < 0.25 && dist > 0.7) {
            const st = Math.min(dist - 0.65, RUNNER.lunge * dt / 0.25);
            G.World.move(this.pos, Math.sin(this.facing) * st, Math.cos(this.facing) * st, RADIUS, this.lv);
            this.lungeT = 1;
          }
          if (this.timer <= 0) {
            const hit = combat ? combat.zombieStrike(this, player, Math.hypot(px - this.pos.x, pz - this.pos.z)) : false;
            // si falla porque esquivaste, se queda vendido un rato (ventana para contraatacar)
            const over = this.overextended; this.overextended = false;
            this.strikeT = 0; this.strikeHit = hit;
            if (this.state === 'grapple') break;          // te agarró: empieza el forcejeo
            this.enter('recover', over ? 1.1 : (hit ? 0.55 : 0.4));
            // esquivado: se pasa de largo y queda aturdido un momento (se le puede rematar)
            if (over) { this.stun(1.25, Math.sin(this.facing), Math.cos(this.facing), 1.2); this.exposed = true; if (G.Mode && G.Mode.stats) G.Mode.stats.stun++; }
          }
          break;
        case 'recover':
          this.timer -= dt;
          this.strikeT = (this.strikeT || 0) + dt;
          this.reach = Math.max(this.reach, 0.5);
          this.facing = U.turnToward(this.facing, Math.atan2(dx, dz), 3 * dt);
          if (this.timer <= 0) this.enter('chase', 0);
          break;
        case 'bang':
          this.updateBang(dt, player, dist, sees);
          break;
      }

      let moved = 0;
      if (speed > 0 && this.target) moved = this.stepToward(this.target, speed, dt);
      this.speedNow = moved;

      if (speed > 0 && moved < speed * 0.25 && this.state !== 'bang' && this.state !== 'climb') {
        this.stuck += dt;
        if (this.stuck > 1.2) { this.clear = false; this.clearTimer = 1; this.pathTimer = 0; }
        if (this.stuck > 6) { this.target = null; this.enter('idle', 2); }
      } else this.stuck = Math.max(0, this.stuck - dt);

      // separación entre zombis
      for (let i = 0; i < all.length; i++) {
        const o = all[i];
        if (o === this || !o.alive || o.downed) continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 0.3 && d2 > 1e-4) {
          const d = Math.sqrt(d2), push = (0.55 - d) * 0.5;
          G.World.move(this.pos, ox / d * push, oz / d * push, RADIUS, this.lv);
        }
      }
      // no atravesar al jugador
      if (!player.dead && dist < 0.55 && dist > 1e-3) {
        const push = (0.55 - dist);
        G.World.move(this.pos, -dx / dist * push, -dz / dist * push, RADIUS, this.lv);
      }

      this.phase += dt * (1.4 + this.speedNow * (this.runner && this.speedNow > 1.5 ? 3.4 : 5.5));
      this.apply(dt);
    }

    knockback(dt) {
      const k = this.kb;
      if (Math.abs(k.x) + Math.abs(k.z) < 0.01) return;
      const x0 = this.pos.x, z0 = this.pos.z;
      G.World.move(this.pos, k.x * dt, k.z * dt, RADIUS, this.lv);
      // contra una pared: se estampa, rebota un poco y se queda aturdido más rato
      const sp = Math.hypot(k.x, k.z), moved = Math.hypot(this.pos.x - x0, this.pos.z - z0);
      if (sp > 1.6 && moved < sp * dt * 0.4 && this.alive && !this.wallHit) {
        this.wallHit = true;
        k.x *= -0.25; k.z *= -0.25;
        if (this.state === 'stagger') { this.reactKind = 'wall'; this.reactDur = 0.9; this.timer = 0.9; this.stagger = 0.001; }
        if (G.World.emit) G.World.emit(this.pos.x, this.pos.z, 4, this.lv);
        return;
      }
      const f = Math.max(0, 1 - dt * 4.2);
      k.x *= f; k.z *= f;
    }

    // ---------- Puertas, ventanas y vallas ----------
    updateBang(dt, player, dist, sees) {
      const W = G.World, E = W.E;
      const ref = this.edge;
      const e = ref ? W.edgeGet(ref) : E.NONE;
      if (!ref || !W.blocksWalkEdge(e)) { this.edge = null; this.enter(this.resume, 12); return; }
      if (W.climbableEdge(e)) { this.startClimb(ref, e); return; }
      const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
      this.facing = U.turnToward(this.facing, Math.atan2(mx - this.pos.x, mz - this.pos.z), 4 * dt);
      this.bangT += dt;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 1;
        W.emit(mx, mz, 9, this.lv);
        if (W.damageEdge(ref, 1)) {
          const after = W.edgeGet(ref);
          if (W.climbableEdge(after)) this.startClimb(ref, after);
          else { this.edge = null; this.enter(this.resume, 12); }
        }
      }
      // si deja de oír o ver al jugador durante mucho rato, se rinde
      if (!sees && this.bangT > 25 && dist > 12) { this.edge = null; this.target = null; this.enter('idle', 3); }
    }

    startClimb(ref, e) {
      const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
      const nx = ref.o === 'N' ? 0 : 1, nz = ref.o === 'N' ? 1 : 0;
      const side = (this.pos.x - mx) * nx + (this.pos.z - mz) * nz > 0 ? 1 : -1;
      const tx = mx - nx * side * 0.6, tz = mz - nz * side * 0.6;
      if (G.World.circleBlocked(tx, tz, RADIUS, this.lv)) { this.edge = null; this.enter('idle', 2); return; }
      this.climbing = { x0: this.pos.x, z0: this.pos.z, x1: tx, z1: tz, t: 0, dur: e === G.World.E.FENCE ? 1.4 : 2.0 };
      this.facing = Math.atan2(tx - this.pos.x, tz - this.pos.z);
      this.edge = null;
      this.state = 'climb';
    }

    // Si la meta está en otra planta, primero va a la escalera (arriba o abajo)
    routeGoal(goal) {
      const lv = this.lv || 0;
      if (goal.lv == null || goal.lv === lv) return goal;
      const W = G.World;
      const b = W.bldAt(Math.floor(goal.x), Math.floor(goal.z), goal.lv) || W.bldAt(Math.floor(this.pos.x), Math.floor(this.pos.z), lv);
      const s = b && b.stair;
      if (!s) return goal;
      const k = lv === 0 ? s.len - 1 : 0;
      const sx = s.x + s.dx * k + 0.5, sz = s.z + s.dz * k + 0.5;
      // la casilla del otro extremo de la escalera: al pasar la mitad ya cambia de planta
      return { x: sx, z: sz, lv };
    }

    // Avanza hacia la meta: en línea recta si se puede, si no con A*
    stepToward(goal, speed, dt) {
      const W = G.World;
      goal = this.routeGoal(goal);
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) {
        this.clear = W.hasClearLine(this.pos.x, this.pos.z, goal.x, goal.z, this.lv);
        this.clearTimer = 0.25;
      }
      let gx = goal.x, gz = goal.z;
      if (!this.clear) {
        this.pathTimer -= dt;
        if (this.pathTimer <= 0) {
          this.path = W.findPath(this.pos.x, this.pos.z, goal.x, goal.z, 0, this.lv);
          this.pathTimer = 1 + Math.random() * 0.6;
        }
        if (this.path) {
          while (this.path.length && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.35) this.path.shift();
          if (this.path.length) {
            gx = this.path[0].x; gz = this.path[0].z;
            // ¿hay una puerta, ventana o valla entre esta casilla y la siguiente?
            const tx = Math.floor(this.pos.x), tz = Math.floor(this.pos.z);
            const nx = Math.floor(gx), nz = Math.floor(gz);
            if (Math.abs(nx - tx) + Math.abs(nz - tz) === 1) {
              const ref = W.edgeRefBetween(tx, tz, nx, nz, this.lv);
              const e = W.edgeGet(ref);
              if (W.blocksWalkEdge(e)) {
                const mx = ref.o === 'N' ? ref.x + 0.5 : ref.x, mz = ref.o === 'N' ? ref.z : ref.z + 0.5;
                const dEdge = ref.o === 'N' ? Math.abs(this.pos.z - mz) : Math.abs(this.pos.x - mx);
                if (dEdge < 0.6) {
                  this.resume = this.state === 'chase' ? 'chase' : 'investigate';
                  if (W.climbableEdge(e)) { this.startClimb(ref, e); return 0; }
                  this.edge = ref; this.bangT = 0;
                  this.state = 'bang'; this.timer = 0.6;
                  return 0;
                }
                // ir hacia el centro de la arista
                gx = ref.o === 'N' ? mx : gx; gz = ref.o === 'N' ? gz : mz;
                if (ref.o === 'N') gz = mz + (tz < nz ? -0.3 : 0.3);
                else gx = mx + (tx < nx ? -0.3 : 0.3);
              }
            }
          }
        }
      } else this.path = null;

      const ddx = gx - this.pos.x, ddz = gz - this.pos.z;
      const d = Math.hypot(ddx, ddz);
      if (d < 0.01) return 0;
      this.facing = U.turnToward(this.facing, Math.atan2(ddx, ddz), 3 * dt);
      const step = speed * dt;
      const bx = this.pos.x, bz = this.pos.z;
      W.move(this.pos, ddx / d * step, ddz / d * step, RADIUS, this.lv);
      return Math.hypot(this.pos.x - bx, this.pos.z - bz) / Math.max(dt, 1e-4);
    }

    // ---------- Modelo ----------
    apply(dt) {
      const m = this.model;
      this.lv = G.World.levelAt(this.pos.x, this.pos.z, this.lv);
      this.y += (G.World.groundY(this.pos.x, this.pos.z, this.lv) - this.y) * Math.min(1, (dt || 0.016) * 14);
      m.root.position.set(this.pos.x, this.y + (this.lift || 0), this.pos.z);
      // lejos de la cámara: malla más ligera, sin sombra y animada cada 2 o 3 fotogramas
      const cp = G.Camera && G.Camera.pos;
      let skip = 1;
      if (cp) {
        const d = Math.hypot(cp.x - this.pos.x, cp.z - this.pos.z);
        const q = G.Quality ? G.Quality.cur : { lod: [18, 36], shadowZ: 22, animFar: 2 };
        G.Models.setLOD(m, lodFor(m.lod, d, q.lod[0], q.lod[1]));
        const sh = d < q.shadowZ;
        if (m.mesh.castShadow !== sh) m.mesh.castShadow = sh;
        if (d > q.lod[0] && this.state !== 'attack' && this.state !== 'combo' && this.state !== 'runatk' && this.state !== 'grabbed' && !(this.fall > 0)) skip = d > q.lod[1] ? q.animFar + 1 : q.animFar;
      }
      m.root.rotation.y = this.facing;
      this.poseDt = (this.poseDt || 0) + (dt || 0);
      this.poseN = ((this.poseN || 0) + 1) % 997;
      if (skip > 1 && (this.poseN + (this.look.seed | 0)) % skip !== 0) return;
      dt = this.poseDt; this.poseDt = 0;
      // espasmos: sacudidas sueltas de cabeza y hombros, más seguidas al perseguir
      if (this.state !== 'dead' && !(this.fall > 0)) {
        this.twitchT = (this.twitchT == null ? Math.random() * 4 : this.twitchT) - (dt || 0);
        if (this.twitchT <= 0) {
          this.twitch = 1;
          this.twitchKind = (Math.random() * 4) | 0;
          this.twitchT = ((this.state === 'chase' ? 1.2 : 2.5) + Math.random() * 4) * (this.runner ? 0.5 : 1);
        }
      }
      this.twitch = Math.max(0, (this.twitch || 0) - (dt || 0) * 3.2);
      G.Models.poseZombie(m, {
        phase: this.phase, amt: Math.min(1, this.speedNow / 0.9) * 0.7,
        chase: this.state === 'chase' || this.state === 'attack' || this.state === 'recover' || this.state === 'bang' || this.state === 'alert' || this.state === 'combo' || this.state === 'runatk',
        runner: this.runner, sprint: this.runner && this.state === 'chase' ? Math.min(1, this.speedNow / 2.5) : 0,
        alert: this.state === 'alert' ? 1 - this.timer / 0.55 : 0,
        armsUp: this.look.armsUp || 0,
        reach: this.reach, stagger: this.state === 'stagger' ? this.stagger : 0, flinch: this.flinch || 1,
        react: this.state === 'stagger' ? (this.reactKind || 'push') : null, reactDur: this.reactDur || 0.55,
        atk: this.state === 'attack' ? (this.atkU || 0) : null,
        burn: this.state === 'burning' || this.state === 'burnroll' ? (this.state === 'burnroll' ? 2 : 1) : null,
        punch: this.state === 'combo' ? { kind: COMBO[this.combo.step].kind, t: Math.min(1, this.combo.t) }
          : (this.state === 'runatk' ? { kind: 'runatk', t: Math.min(1, this.combo.t) } : null),
        grapple: this.state === 'grapple' ? (this.grappleT || 0) : null,
        stun: this.state === 'stun' ? { t: this.stunT || 0, dur: this.stunDur || 1.5 } : null,
        held: this.state === 'held' ? { kind: this.heldKind, t: this.heldT || 0 } : null,
        // muerto en un remate contra la pared o la mesa: se queda en la pose final de ese remate
        corpse: this.corpseKind && this.state === 'dead' ? { kind: this.corpseKind, t: Math.min(1, (this.heldT || 0.6) + (1 - (this.heldT || 0.6)) * (this.fall || 0)) } : null,
        blind: this.blind,
        strike: this.state === 'recover' && this.strikeT != null ? Math.min(1, this.strikeT / 0.5) : null, strikeHit: !!this.strikeHit,
        grabbed: this.state === 'grabbed' ? (this.grabT || 0) : null,
        twitch: this.twitch || 0, twitchKind: this.twitchKind || 0,
        bang: this.state === 'bang' ? this.bangT : 0,
        drag: this.look.drag, seed: this.look.seed % 7, lean: this.lean, tilt: this.tilt,
        dt: dt || 0.016, time: (this.time = (this.time || 0) + (dt || 0))
      });
      if (this.state === 'burnroll') {
        // tumbado de espaldas, rodando de un lado a otro sobre sí mismo
        const f = U.smooth(Math.min(1, this.fall));
        m.body.rotation.x = -Math.PI / 2 * f; m.body.position.y = 0.12 * f; m.body.position.z = 0;
        m.body.rotation.y = Math.sin((this.rollT || 0) * 4.2) * 1.25 * f * (1 - 0.6 * U.smooth(((this.rollT || 0) - 2.2) / 1)) ;
      } else if (this.fall > 0 && !this.corpseKind) G.Models.poseFall(m, this.fall, this.fallDir);
      else { m.body.rotation.x = 0; m.body.rotation.y = 0; m.body.position.y = 0; }
    }

    // Datos para dormirlo y despertarlo después
    snapshot() {
      return { x: this.pos.x, z: this.pos.z, lv: this.lv || 0, facing: this.facing, look: this.look, hp: this.hp, dead: !this.alive, fallDir: this.fallDir, homebound: this.homebound };
    }
  }

  // Nivel de detalle con un margen para que no cambie a cada paso
  function lodFor(cur, d, L1, L2) {
    const h = 1.5;
    if (cur === 1) return d > L1 + h ? (d > L2 + h ? -1 : 0) : 1;
    if (cur === 0) return d < L1 - h ? 1 : (d > L2 + h ? -1 : 0);
    return d < L2 - h ? (d < L1 - h ? 1 : 0) : -1;
  }

  Zombie.randomLook = randomLook;
  G.Zombie = Zombie;
})(window.Game = window.Game || {});

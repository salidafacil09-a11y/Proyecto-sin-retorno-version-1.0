(function (G) {
  'use strict';

  // Objetos sueltos y arrojables (inspirado en el vídeo de referencia, con diseño y números propios)
  // - Los objetos aparecen encima de mesas, mostradores y escritorios, o en el suelo, repartidos por el mapa.
  //   Brillan un poco; de cerca muestran su icono blanco y se cogen con ∆ / T de pasada (un gesto rápido,
  //   sin pararse: si está en una mesa, estira el brazo; si está en el suelo, se agacha).
  // - Arrojables: ladrillo y botella. Solo se lleva uno. G, la cruceta arriba o el botón Lanzar lo tiran
  //   con un lanzamiento rápido al infectado fijado (el más centrado delante); si no hay ninguno, hacia
  //   donde miras. Al darle queda aturdido unos segundos (listo para rematarlo). Al caer hace ruido.

  const U = G.Util;
  const KINDS = {
    mun_9mm: { name: 'balas de 9 mm', n: [2, 4], w: 3, lift: 0 },
    venda: { name: 'venda', n: [1, 1], w: 0.3, lift: 0 },            // rara: lo normal es fabricarla
    alcohol: { name: 'botella de alcohol', n: [1, 1], w: 2.2, lift: 0.04 },
    trapo: { name: 'trapo', n: [1, 1], w: 1.3, lift: 0.01 },
    ladrillo: { name: 'Ladrillo', n: [1, 1], w: 2, lift: 0.034, thr: true },
    botella: { name: 'Botella', n: [1, 1], w: 2, lift: 0.035, thr: true },
    molotov: { name: 'Molotov', n: [1, 1], w: 0, lift: 0.035, thr: true }       // se fabrica: botella + alcohol
  };
  const TABLES = { mesita: 1, comoda: 1, encimera: 1, mesa: 1, escritorio: 1, mostrador: 1, banco: 1, mueble_tv: 1, cajas: 1, carrito: 1, fregadero: 1 };
  const REACH = 1.55;            // distancia para cogerlo
  const ICON_D = 6;              // a esta distancia se ve el icono
  const GLINT_D = 16;            // y el brillo
  const THROW_SPEED = 15, GRAV = 9.8;

  // munición con color (para distinguirla de un vistazo); lo demás, en blanco
  const TINT = { mun_9mm: '#f0b43c' };
  const tintCache = {};
  function tinted(id, url, cb) {
    if (tintCache[id]) { cb(tintCache[id]); return; }
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      // conserva el sombreado del icono blanco y lo tiñe
      x.globalCompositeOperation = 'multiply'; x.fillStyle = TINT[id]; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(im, 0, 0);
      try { tintCache[id] = c.toDataURL('image/png'); } catch (e) { tintCache[id] = url; }
      cb(tintCache[id]);
    };
    im.onerror = () => cb(url);
    im.src = url;
  }

  let arc = null, arcGeo = null, landMark = null, arcPts = null;
  const ARC_N = 96;
  let scene = null, mat = null, glintTex = null, layer = null, lockEl = null;
  const items = [];              // { id, n, x, y, z, lv, mesh, glint, el }
  const flying = [];             // proyectiles en vuelo
  let points = null;             // posibles sitios (se calculan una vez por mundo)
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();

  function texGlint() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.18, 'rgba(255,245,210,0.55)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    // destello en cruz
    x.fillStyle = 'rgba(255,255,245,0.85)';
    x.fillRect(31, 4, 2, 56); x.fillRect(4, 31, 56, 2);
    return new THREE.CanvasTexture(c);
  }

  function init(sc) {
    scene = sc;
    mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    glintTex = texGlint();
    layer = document.getElementById('picks');
    lockEl = document.getElementById('thr-lock');
    // línea de trayectoria (botella o ladrillo apuntando, y flechas): una cinta verde agua semitransparente
    // que mira a la cámara, y una marca donde cae
    const N = ARC_N;
    arcPts = new Float32Array(N * 3);
    arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = [];
    for (let k = 0; k < N - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    arcGeo.setIndex(idx);
    arcGeo.setDrawRange(0, 0);
    arc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0x5ff0cf, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    arc.frustumCulled = false; arc.visible = false; arc.renderOrder = 5;
    scene.add(arc);
    landMark = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0x5ff0cf, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    landMark.rotation.x = -Math.PI / 2; landMark.visible = false; landMark.renderOrder = 5;
    scene.add(landMark);
  }

  // A dónde va un lanzamiento sin blanco: hacia donde mira la cámara, al suelo o a lo que haya (máx. 16 m)
  function freeAim(player) {
    const C = G.Camera;
    _o.copy(C.pos); _d.copy(C.dir).normalize();
    let t = 16;
    if (_d.y < -0.02) t = Math.min(t, (_o.y - player.y) / -_d.y);
    return _o.clone().addScaledVector(_d, Math.max(4, t));
  }
  function throwVel(start, aim) {
    const dx = aim.x - start.x, dz = aim.z - start.z, dh = Math.hypot(dx, dz) || 0.01;
    const T = Math.max(0.15, dh / THROW_SPEED);
    return new THREE.Vector3(dx / T, (aim.y - start.y + 0.5 * GRAV * T * T) / T, dz / T);
  }
  // simula una trayectoria con gravedad g desde start con velocidad v; guarda los puntos (cada ~0,35 m) y
  // dónde para (suelo, mueble, pared). Devuelve el número de puntos
  const _a0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _av = new THREE.Vector3();
  function simPath(start, v, g, lv, maxT) {
    const W = G.World;
    _a1.copy(start); _av.copy(v);
    const sp = Math.max(1, _av.length()), dt = Math.min(0.03, 0.35 / sp);
    let n = 0, land = null;
    arcPts[0] = _a1.x; arcPts[1] = _a1.y; arcPts[2] = _a1.z; n = 1;
    for (let t = 0; t < maxT && n < ARC_N; t += dt) {
      _a0.copy(_a1);
      _av.y -= g * dt; _a1.addScaledVector(_av, dt);
      if (W.lineHit(_a0.x, _a0.z, _a1.x, _a1.z, W.blocksSightEdge, lv) >= 0) { land = null; break; }
      const gy0 = W.groundY(_a1.x, _a1.z, lv), gy = gy0 + Math.max(0, W.furnTop(_a1.x, _a1.z, lv) - gy0);
      if (_a1.y <= gy) { _a1.y = gy; land = _a1.clone(); arcPts[n * 3] = _a1.x; arcPts[n * 3 + 1] = _a1.y + 0.02; arcPts[n * 3 + 2] = _a1.z; n++; break; }
      arcPts[n * 3] = _a1.x; arcPts[n * 3 + 1] = _a1.y; arcPts[n * 3 + 2] = _a1.z; n++;
    }
    return { n, land };
  }
  // dibuja la cinta con los n puntos de arcPts (ancho según la distancia a la cámara)
  function drawArc(n, land, camera) {
    if (n < 2) { arc.visible = false; landMark.visible = false; return; }
    const pos = arcGeo.attributes.position.array, cp = camera.position;
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      const tx = arcPts[b * 3] - arcPts[a * 3], ty = arcPts[b * 3 + 1] - arcPts[a * 3 + 1], tz = arcPts[b * 3 + 2] - arcPts[a * 3 + 2];
      const vx = cp.x - arcPts[k * 3], vy = cp.y - arcPts[k * 3 + 1], vz = cp.z - arcPts[k * 3 + 2];
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const dist = Math.hypot(vx, vy, vz), sl = Math.hypot(sx, sy, sz) || 1;
      const w = (0.012 + 0.0025 * dist) / sl;
      sx *= w; sy *= w; sz *= w;
      pos[k * 6] = arcPts[k * 3] + sx; pos[k * 6 + 1] = arcPts[k * 3 + 1] + sy; pos[k * 6 + 2] = arcPts[k * 3 + 2] + sz;
      pos[k * 6 + 3] = arcPts[k * 3] - sx; pos[k * 6 + 4] = arcPts[k * 3 + 1] - sy; pos[k * 6 + 5] = arcPts[k * 3 + 2] - sz;
    }
    arcGeo.attributes.position.needsUpdate = true;
    arcGeo.setDrawRange(0, (n - 1) * 6);
    arc.visible = true;
    if (land) { landMark.position.set(land.x, land.y + 0.03, land.z); landMark.visible = true; } else landMark.visible = false;
  }
  function hideArc() { if (arc) { arc.visible = false; landMark.visible = false; } }
  // botella o ladrillo en la mano y apuntando: desde la mano
  function updateArc(player, camera) {
    const h = player.model;
    h.root.updateMatrixWorld(true);
    const start = h.handR.getWorldPosition(new THREE.Vector3());
    const r = simPath(start, throwVel(start, freeAim(player)), GRAV, player.lv || 0, 3);
    drawArc(r.n, r.land, camera);
  }


  // ---------- Sitios donde pueden aparecer ----------
  function findPoints() {
    const W = G.World, out = [];
    const CS = W.CS, A0 = W.ARENA_MIN, A1 = W.ARENA_MAX;
    const c0 = Math.floor(A0 / CS), c1 = Math.floor((A1 - 1) / CS);
    const rng = U.mulberry32(((W.stats().seed || 1) % 100000) + 77);
    for (let cz = c0; cz <= c1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        const c = W.chunkAt(cx, cz);
        for (const f of c.furn) {
          if (!TABLES[f.type] || (f.x1 - f.x0) < 0.35 || (f.z1 - f.z0) < 0.3) continue;
          const x = U.lerp(f.x0 + 0.12, f.x1 - 0.12, rng()), z = U.lerp(f.z0 + 0.1, f.z1 - 0.1, rng());
          // que no haya otro mueble encima (una estantería, por ejemplo)
          if (W.furnTop(x, z, f.lv || 0) > f.y + f.h + 0.1) continue;
          out.push({ x, z, y: f.y + f.h, lv: f.lv || 0, table: true });
        }
      }
    }
    // en el suelo: dentro y fuera de los edificios, lejos de las paredes
    for (let i = 0, tries = 0; i < 70 && tries < 900; tries++) {
      const x = U.lerp(A0 + 3, A1 - 3, rng()), z = U.lerp(A0 + 3, A1 - 3, rng());
      if (W.circleBlocked(x, z, 0.45, 0) || W.furnTop(x, z, 0, 0.3) > 0) continue;
      out.push({ x, z, y: W.groundY(x, z, 0), lv: 0, table: false, indoor: W.isIndoor(Math.floor(x), Math.floor(z), 0) });
      i++;
    }
    return out;
  }

  function pickKind(rng, weights) {
    let tot = 0;
    for (const k in weights) tot += weights[k];
    let r = rng() * tot;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return 'mun_9mm';
  }

  function makeMesh(id) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(G.Models.weaponGeometry(id), mat);
    m.rotation.x = Math.PI / 2;            // tumbado: lo que en el modelo es -Z queda arriba
    m.position.y = KINDS[id].lift || 0;
    m.castShadow = true;
    g.add(m);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    s.material.toneMapped = false;
    s.scale.setScalar(0.22);
    s.position.y = 0.09;
    g.add(s);
    return { group: g, glint: s };
  }

  function add(id, n, p) {
    const k = KINDS[id];
    const it = { id, n: n != null ? n : k.n[0] + Math.floor(Math.random() * (k.n[1] - k.n[0] + 1)), x: p.x, y: p.y, z: p.z, lv: p.lv || 0, ph: Math.random() * 6 };
    const mm = makeMesh(id);
    it.mesh = mm.group; it.glint = mm.glint;
    it.mesh.position.set(p.x, p.y + 0.004, p.z);
    it.mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(it.mesh);
    if (layer) {
      const u = G.Icons.white(id);
      const d = document.createElement('div');
      d.className = 'pk hidden k-' + id + (id.indexOf('mun') === 0 ? ' k-mun' : '');
      d.innerHTML = (u ? '<img alt="">' : '') + (it.n > 1 ? '<span>' + it.n + '</span>' : '') + '<i></i>';
      if (u) {
        const img = d.querySelector('img');
        if (TINT[id]) tinted(id, u, (t) => { img.src = t; }); else img.src = u;
      }
      layer.appendChild(d);
      it.el = d;
    }
    items.push(it);
    return it;
  }

  function removeAt(i) {
    const it = items[i];
    if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
    it.glint.material.dispose();
    if (it.el) it.el.remove();
    items.splice(i, 1);
  }

  function clear() {
    while (items.length) removeAt(items.length - 1);
    for (const f of flying) if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    flying.length = 0;
    Fire.clear();
  }

  // n objetos repartidos (al menos a 5 m entre sí y a 4 m de la protagonista), con pesos por tipo
  function spawn(n, opts) {
    opts = opts || {};
    if (!points) points = findPoints();
    const P = G.debug && G.debug.player;
    const rng = Math.random;
    const weights = opts.weights || { mun_9mm: KINDS.mun_9mm.w, venda: KINDS.venda.w, alcohol: KINDS.alcohol.w, trapo: KINDS.trapo.w, ladrillo: KINDS.ladrillo.w, botella: KINDS.botella.w };
    let made = 0;
    for (let tries = 0; made < n && tries < n * 30; tries++) {
      const p = points[Math.floor(rng() * points.length)];
      if (!p) break;
      if (P && Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 4) continue;
      if (items.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 4.5)) continue;
      const id = pickKind(rng, weights);
      // los arrojables caen más en el suelo y en la calle; lo demás, más en las mesas
      if (KINDS[id].thr && p.table && rng() < 0.5) continue;
      if (!KINDS[id].thr && !p.table && rng() < 0.4) continue;
      add(id, null, p);
      made++;
    }
    return made;
  }

  // Al reiniciar el mundo
  function reset() { clear(); points = null; }

  // ---------- Coger ----------
  // el objeto más cercano que se puede coger (al alcance y sin pared en medio)
  function near(player) {
    let best = null, bd = REACH;
    for (const it of items) {
      if ((it.lv || 0) !== (player.lv || 0)) continue;
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
      if (d < bd && Math.abs(it.y - player.y) < 1.6) { bd = d; best = it; }
    }
    if (best && !G.World.hasLOS(player.pos.x, player.pos.z, best.x, best.z, player.lv)) best = null;
    return best;
  }
  function label(it) {
    const k = KINDS[it.id];
    return 'Coger ' + (k.thr ? k.name.toLowerCase() : (it.n > 1 ? it.n + ' ' : '') + k.name);
  }

  function startPickup(player, it) {
    if (!it || player.busy() || player.struggle) return null;
    const k = KINDS[it.id];
    if (k.thr && player.throwable) return 'Ya llevas ' + (player.throwable === 'ladrillo' ? 'un ladrillo' : (player.throwable === 'molotov' ? 'una molotov' : 'una botella')) + ' (lánzalo antes)';
    if (!k.thr && player.itemRoom(it.id) <= 0) return 'No te cabe más ' + k.name;
    const hi = it.y - player.y > 0.45;
    player.action = { kind: hi ? 'pickupHi' : 'pickup', t: 0, dur: hi ? 0.5 : 0.62, impact: 0.42, face: Math.atan2(it.x - player.pos.x, it.z - player.pos.z), item: it, done: false };
    return null;
  }

  function collect(player, a) {
    const it = a.item, i = items.indexOf(it);
    if (i < 0) return;
    const k = KINDS[it.id];
    let msg;
    if (k.thr) {
      if (player.throwable) return;
      player.throwable = it.id;
      player.equip(-2);                        // se pone en la mano (se cambia con la cruz de armas)
      msg = (it.id === 'ladrillo' ? 'Ladrillo' : 'Botella') + ' en la mano: apunta para ver dónde cae y ataca para lanzar' + (it.id === 'ladrillo' ? 'lo' : 'la');
      removeAt(i);
    } else {
      const r = player.takeItem(it.id, it.n);
      msg = r.msg;
      if (r.left > 0) { it.n = r.left; const s = it.el && it.el.querySelector('span'); if (s) s.textContent = it.n; }
      else removeAt(i);
    }
    if (Pickups.onMessage) Pickups.onMessage(msg, 'good');
    if (G.Mode && G.Mode.stats) G.Mode.stats.picked++;
  }

  // ---------- Lanzar ----------
  // infectado fijado: el más centrado hacia donde miras, hasta 15 m, a la vista
  function lockTarget(player, zombies, camYaw) {
    let best = null, bs = Infinity;
    for (const z of zombies) {
      if (!z.alive || !z.standing || (z.lv || 0) !== (player.lv || 0) || z.state === 'held' || z.state === 'grapple') continue;
      const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d > 15 || d < 0.8) continue;
      const a = Math.abs(U.angleDiff(Math.atan2(dx, dz), camYaw));
      if (a > 0.75) continue;
      const s = a * 6 + d * 0.25;
      if (s < bs && G.World.hasLOS(player.pos.x, player.pos.z, z.pos.x, z.pos.z, player.lv)) { bs = s; best = z; }
    }
    return best;
  }

  function startThrow(player, zombies, camYaw) {
    if (!player.throwable) return null;
    if (player.busy() || player.struggle || player.dead || player.climb) return null;
    // apuntando con él en la mano: va por la parábola que ves; si no, al infectado fijado (si hay)
    const tgt = player.aiming && player.holdingThr ? null : lockTarget(player, zombies, camYaw);
    const face = tgt ? Math.atan2(tgt.pos.x - player.pos.x, tgt.pos.z - player.pos.z) : camYaw;
    player.action = { kind: 'throw', t: 0, dur: 0.78, impact: 0.46, face, item: player.throwable, target: tgt, done: false };
    if (player.stance === 'prone') player.stance = 'crouch';
    return null;
  }

  // suelta el proyectil desde la mano (lo llama Combat en el momento del lanzamiento)
  function release(player, a) {
    const id = a.item;
    if (!id || player.throwable !== id) return;
    player.throwable = null;
    if (player.cur === -2) { const b = player.prev; player.equip(b >= 0 && player.hands[b] ? b : -1); if (player.aiming && G.Input && G.Input.setAim) G.Input.setAim(false); }
    const h = player.model;
    h.root.updateMatrixWorld(true);
    const start = h.handR.getWorldPosition(new THREE.Vector3());
    let aim;
    const z = a.target;
    if (z && z.alive) {
      // a la cabeza, donde va a estar cuando llegue
      const d0 = Math.hypot(z.pos.x - start.x, z.pos.z - start.z);
      const T = Math.max(0.12, d0 / THROW_SPEED);
      const vx = (z.speedNow || 0) * Math.sin(z.facing), vz = (z.speedNow || 0) * Math.cos(z.facing);
      aim = new THREE.Vector3(z.pos.x + vx * T * 0.8, z.y + 1.5, z.pos.z + vz * T * 0.8);
    } else aim = freeAim(player);       // hacia donde mira la cámara (lo que marca la parábola)
    const v = throwVel(start, aim);
    const mesh = new THREE.Mesh(G.Models.weaponGeometry(id), mat);
    mesh.castShadow = true;
    mesh.position.copy(start);
    scene.add(mesh);
    const fl = { id, mesh, p: start, v, spin: new THREE.Vector3(8 + Math.random() * 6, Math.random() * 4, 3), life: 0, lv: player.lv || 0, target: z };
    if (id === 'molotov') fl.flame = Fire.sprite(mesh, 0, 0.17, 0, 0.16);      // el trapo va encendido
    flying.push(fl);
    G.World.emit(player.pos.x, player.pos.z, 2, player.lv);
    if (G.Mode && G.Mode.stats) G.Mode.stats.thrown++;
  }

  function impact(f, p, d, z) {
    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    if (f.flame) Fire.detachSprite(f.flame);
    if (f.id === 'molotov') {
      // se rompe y prende: un charco de fuego donde cae (o a los pies del infectado al que le dio)
      if (G.Guns && G.Guns.burst) G.Guns.burst(p, d, false, 8);
      G.World.emit(p.x, p.z, 12, f.lv);
      const W = G.World, gx = z ? z.pos.x : p.x, gz = z ? z.pos.z : p.z;
      Fire.spawn(gx, W.groundY(gx, gz, f.lv), gz, f.lv, z);
      if (G.Camera.hitFx) G.Camera.hitFx(0.2, 1);
      return;
    }
    const brick = f.id === 'ladrillo';
    if (G.Guns && G.Guns.burst) G.Guns.burst(p, d, false, brick ? 7 : 10);
    // el golpe se oye: atrae a los que no te han visto (sirve de distracción)
    G.World.emit(p.x, p.z, brick ? 8 : 10, f.lv);
    if (z) {
      z.takeHit(brick ? 0.45 : 0.3, 0.2, d.x, d.z, false, 1, 'side', 'body');
      if (z.alive) {
        z.stun(z.blind ? 1.7 : 2.6, d.x, d.z, 1.6);
        if (G.Mode && G.Mode.stats) G.Mode.stats.stun++;
      }
      if (G.Combat.onHit) G.Combat.onHit(z.alive ? 'hit' : 'kill', false);
      if (G.Camera.hitFx) G.Camera.hitFx(0.25, 1);
      if (Pickups.onMessage) Pickups.onMessage('¡Aturdido! Remátalo', 'good');
    }
  }

  function updateFlying(dt, zombies) {
    const W = G.World;
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      f.life += dt;
      const p0 = f.p.clone();
      f.v.y -= GRAV * dt;
      f.p.addScaledVector(f.v, dt);
      const seg = f.p.clone().sub(p0), L = seg.length() || 1e-4;
      _d.copy(seg).divideScalar(L);
      let done = false;
      // infectados
      let bz = null, bt = Infinity;
      for (const z of zombies) {
        if (!z.alive || (z.lv || 0) !== f.lv) continue;
        if (Math.abs(z.pos.x - p0.x) > L + 1.5 || Math.abs(z.pos.z - p0.z) > L + 1.5) continue;
        const h = G.Guns.hitZombie(z, p0, _d);
        if (h && h.t <= L + 0.15 && h.t < bt) { bt = h.t; bz = z; }
      }
      const fw = W.lineHit(p0.x, p0.z, f.p.x, f.p.z, W.blocksSightEdge, f.lv);
      const tW = fw >= 0 ? fw * L : Infinity;
      const gy = W.groundY(f.p.x, f.p.z, f.lv) + Math.max(0, W.furnTop(f.p.x, f.p.z, f.lv) - W.groundY(f.p.x, f.p.z, f.lv));
      const tG = f.p.y < gy ? L * (p0.y - gy) / Math.max(1e-4, p0.y - f.p.y) : Infinity;
      if (bz && bt <= tW && bt <= tG) { impact(f, p0.clone().addScaledVector(_d, bt), _d.clone(), bz); done = true; }
      else if (tW < Infinity || tG < Infinity) { impact(f, p0.clone().addScaledVector(_d, Math.max(0, Math.min(tW, tG) - 0.05)), _d.clone(), null); done = true; }
      else if (f.life > 4) { if (f.mesh.parent) f.mesh.parent.remove(f.mesh); done = true; }
      if (done) { flying.splice(i, 1); continue; }
      f.mesh.position.copy(f.p);
      f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.y += f.spin.y * dt; f.mesh.rotation.z += f.spin.z * dt;
    }
  }

  // ---------- Cada fotograma ----------
  function update(dt, player, zombies, camera, camYaw, playing) {
    updateFlying(dt, zombies);
    Fire.update(dt, player, zombies);
    const t = performance.now() / 1000;
    const Wd = window.innerWidth, H = window.innerHeight;
    const pick = playing && !player.dead ? near(player) : null;
    for (const it of items) {
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
      const sameLv = (it.lv || 0) === (player.lv || 0);
      // brillo que late (más fuerte de cerca)
      const gl = sameLv && d < GLINT_D;
      it.glint.visible = gl;
      if (gl) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3 + it.ph);
        it.glint.material.opacity = (0.25 + 0.55 * pulse) * Math.min(1, (GLINT_D - d) / 4);
        it.glint.scale.setScalar(0.16 + 0.1 * pulse);
      }
      if (!it.el) continue;
      const show = playing && sameLv && d < ICON_D;
      if (!show) { if (!it.el.classList.contains('hidden')) it.el.classList.add('hidden'); continue; }
      _v.set(it.x, it.y + 0.28, it.z).project(camera);
      let sx = (_v.x * 0.5 + 0.5) * Wd, sy = (-_v.y * 0.5 + 0.5) * H;
      const behind = _v.z > 1;
      const off = behind || sx < 24 || sx > Wd - 24 || sy < 24 || sy > H - 24;
      if (off) {
        // fuera de la pantalla: en el borde, hacia donde está
        if (d > 4) { it.el.classList.add('hidden'); continue; }
        let ax = sx - Wd / 2, ay = sy - H / 2;
        if (behind) { ax = -ax; ay = -ay; }
        const k = Math.min((Wd / 2 - 30) / Math.max(1, Math.abs(ax)), (H / 2 - 30) / Math.max(1, Math.abs(ay)));
        sx = Wd / 2 + ax * k; sy = H / 2 + ay * k;
      }
      it.el.classList.remove('hidden');
      it.el.classList.toggle('edge', off);
      it.el.classList.toggle('near', it === pick);
      it.el.style.transform = 'translate(' + Math.round(sx) + 'px,' + Math.round(sy) + 'px) translate(-50%,-50%)';
      it.el.style.opacity = off ? 0.75 : Math.min(1, (ICON_D - d) / 1.5).toFixed(2);
    }
    // blanco fijado mientras llevas un arrojable: un circulito verde agua en su cabeza (el tiro va solo a
    // él, no hace falta parábola); sin blanco, la parábola marca dónde cae
    const free = playing && !player.dead && !player.struggle && !player.action;
    const carrying = free && player.throwable && !player.aiming;
    const lz = carrying ? lockTarget(player, zombies, camYaw) : null;
    // la línea solo al apuntar: con la botella o el ladrillo en la mano, o con el arco
    const bow = free && player.aiming && player.weapon.gun === 'bow' && G.Guns && G.Guns.bowPath;
    if (free && player.aiming && player.holdingThr) updateArc(player, camera);
    else if (bow) { const r = G.Guns.bowPath(player, zombies, arcPts, ARC_N, simPath); if (r) drawArc(r.n, r.land, camera); else hideArc(); }
    else hideArc();
    if (lockEl) {
      const z = lz;
      if (z) {
        z.model.head.getWorldPosition(_v); _v.y += 0.03;
        _v.project(camera);
        if (_v.z < 1) {
          lockEl.classList.remove('hidden');
          lockEl.style.transform = 'translate(' + Math.round((_v.x * 0.5 + 0.5) * Wd) + 'px,' + Math.round((-_v.y * 0.5 + 0.5) * H) + 'px) translate(-50%,-50%)';
        } else lockEl.classList.add('hidden');
      } else lockEl.classList.add('hidden');
    }
    return pick;
  }


  // ---------- Fuego (molotov) ----------
  // Un charco de fuego de FIRE_R m que dura FIRE_T s: prende a los infectados que toca (se queman y pierden
  // vida unos segundos; al impacto el más cercano cae y se revuelca) y te quema si lo pisas
  const FIRE_R = 2.0, FIRE_T = 7, FIRE_HURT = 9, ROLL_D = 1.6;
  const Fire = (() => {
    let tex = null, light = null;
    const zones = [], burners = [], loose = [];
    function flameTex() {
      const c = document.createElement('canvas'); c.width = 32; c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(16, 46, 2, 16, 40, 30);
      g.addColorStop(0, 'rgba(255,250,215,1)'); g.addColorStop(0.22, 'rgba(255,200,60,1)');
      g.addColorStop(0.55, 'rgba(245,110,20,0.85)'); g.addColorStop(1, 'rgba(170,35,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(16, 2); x.quadraticCurveTo(30, 34, 26, 52); x.quadraticCurveTo(16, 64, 6, 52); x.quadraticCurveTo(2, 34, 16, 2); x.fill();
      return new THREE.CanvasTexture(c);
    }
    function mat() {
      if (!tex) tex = flameTex();
      const m = new THREE.SpriteMaterial({ map: tex, blending: THREE.NormalBlending, depthWrite: false, transparent: true, opacity: 0.92 });
      m.toneMapped = false;
      return m;
    }
    function ensureLight() {
      // una sola luz que se reutiliza (crear luces nuevas en mitad de la partida da tirones)
      if (light || !scene) return;
      light = new THREE.PointLight(0xff7a2a, 0, 9, 2);
      scene.add(light);
    }
    // una llama suelta pegada a un objeto (o hueso)
    function sprite(parent, x, y, z, size) {
      const sp = new THREE.Sprite(mat());
      sp.position.set(x, y, z); sp.scale.set(size * 0.6, size, 1);
      sp.userData.base = size; sp.userData.ph = Math.random() * 6;
      parent.add(sp); loose.push(sp);
      return sp;
    }
    function detachSprite(sp) {
      if (sp.parent) sp.parent.remove(sp);
      const i = loose.indexOf(sp); if (i >= 0) loose.splice(i, 1);
      sp.material.dispose();
    }
    function spawn(x, y, z, lv, hitZ) {
      ensureLight();
      const g = new THREE.Group(); g.position.set(x, y, z);
      const fl = [];
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * FIRE_R * 0.9;
        const sp = new THREE.Sprite(mat());
        sp.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
        sp.userData.base = 0.75 + Math.random() * 0.8; sp.userData.ph = Math.random() * 6;
        sp.center.set(0.5, 0.05);
        g.add(sp); fl.push(sp);
      }
      // mancha quemada en el suelo (se queda un rato después)
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(FIRE_R * 1.05, 24), new THREE.MeshBasicMaterial({ color: 0x120c08, transparent: true, opacity: 0.55, depthWrite: false }));
      scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.02; scorch.renderOrder = 2;
      g.add(scorch);
      scene.add(g);
      const zone = { x, y, z, lv: lv || 0, t: 0, g, fl, scorch, first: true, hitZ };
      zones.push(zone);
      if (zones.length > 3) kill(zones[0]);
    }
    function kill(zn) {
      if (zn.g.parent) zn.g.parent.remove(zn.g);
      for (const sp of zn.fl) sp.material.dispose();
      zn.scorch.geometry.dispose(); zn.scorch.material.dispose();
      const i = zones.indexOf(zn); if (i >= 0) zones.splice(i, 1);
    }
    // llamas en el cuerpo de un infectado que arde
    function attach(z) {
      if (burners.some((b) => b.z === z)) return;
      const h = z.model, sp = [];
      if (!h || !h.chest) return;
      for (const [bone, y, sz] of [['chest', 0.08, 0.85], ['hips', 0.02, 0.7], ['head', 0.1, 0.55], ['armL', -0.12, 0.45], ['armR', -0.12, 0.45], ['legL', -0.2, 0.45]]) {
        const s2 = new THREE.Sprite(mat());
        s2.position.set(0, y, 0.05); s2.scale.set(sz * 0.6, sz, 1);
        s2.userData.base = sz; s2.userData.ph = Math.random() * 6;
        h[bone].add(s2); sp.push(s2);
      }
      burners.push({ z, sp });
    }
    function clear() {
      while (zones.length) kill(zones[0]);
      for (const b of burners) for (const s2 of b.sp) { if (s2.parent) s2.parent.remove(s2); s2.material.dispose(); }
      burners.length = 0;
      for (const sp of loose.slice()) detachSprite(sp);
      if (light) light.intensity = 0;
    }
    function flick(sp, t, k) {
      const u = sp.userData, f = 0.75 + 0.3 * Math.sin(t * 13 + u.ph) + 0.15 * Math.sin(t * 29 + u.ph * 2);
      sp.scale.set(u.base * 0.6 * (0.9 + 0.2 * Math.sin(t * 17 + u.ph)), u.base * f * k, 1);
      sp.material.opacity = 0.92 * Math.min(1, k * 1.5);
    }
    function update(dt, player, zombies) {
      const t = performance.now() / 1000;
      let li = 0, lp = null;
      for (let i = zones.length - 1; i >= 0; i--) {
        const zn = zones[i];
        zn.t += dt;
        const life = zn.t / FIRE_T;
        if (life >= 1) {
          // las llamas se apagan; la mancha se desvanece despacio
          for (const sp of zn.fl) sp.visible = false;
          zn.scorch.material.opacity = Math.max(0, 0.55 * (1 - (zn.t - FIRE_T) / 15));
          if (zn.t > FIRE_T + 15) kill(zn);
          continue;
        }
        const k = Math.min(1, zn.t * 4) * (1 - U.smooth((life - 0.75) / 0.25));
        for (const sp of zn.fl) flick(sp, t, k);
        if (k > li) { li = k; lp = zn; }
        if (dt <= 0) continue;
        // quién arde: al caer, el más cercano (o al que le dio) cae y se revuelca; el resto se sacude
        const near = [];
        for (const z of zombies) {
          if (!z.alive || (z.lv || 0) !== zn.lv) continue;
          const d = Math.hypot(z.pos.x - zn.x, z.pos.z - zn.z);
          if (d < FIRE_R) near.push({ z, d });
        }
        if (zn.first) {
          zn.first = false;
          near.sort((a, b) => a.d - b.d);
          let rolled = false;
          for (const n of near) {
            const roll = !rolled && (n.z === zn.hitZ || n.d < ROLL_D);
            if (roll) rolled = true;
            n.z.ignite(player, roll);
          }
          if (near.length && Pickups.onMessage) Pickups.onMessage(near.length > 1 ? '¡Arden ' + near.length + '!' : '¡Arde!', 'good');
        } else {
          // los que entran en el fuego después también prenden
          for (const n of near) if (!(n.z.burnT > 0) && k > 0.3) n.z.ignite(player, false);
        }
        // y a ti te quema si estás dentro
        if (!player.dead && (player.lv || 0) === zn.lv && Math.hypot(player.pos.x - zn.x, player.pos.z - zn.z) < FIRE_R * 0.9 && k > 0.3) {
          player.damage(FIRE_HURT * dt, 'Te quemaste.');
          player.hurt = Math.max(player.hurt || 0, 0.25);
        }
      }
      // la luz, en el fuego más vivo
      if (light) {
        if (lp) { light.position.set(lp.x, lp.y + 0.9, lp.z); light.intensity = 2.6 * li * (0.85 + 0.15 * Math.sin(t * 21) + 0.08 * Math.sin(t * 37)); }
        else light.intensity = 0;
      }
      // llamas en los cuerpos
      for (let i = burners.length - 1; i >= 0; i--) {
        const b = burners[i], z = b.z;
        const gone = !z.model || !z.model.root.parent;
        const k = gone ? 0 : Math.min(1, (z.burnT || 0) / 1.2);
        if (k <= 0) {
          for (const s2 of b.sp) { if (s2.parent) s2.parent.remove(s2); s2.material.dispose(); }
          burners.splice(i, 1); continue;
        }
        for (const s2 of b.sp) flick(s2, t, k);
      }
      for (const sp of loose) flick(sp, t, 1);
    }
    return { spawn, attach, sprite, detachSprite, update, clear, get zones() { return zones; } };
  })();
  G.Fire = Fire;

  const Pickups = {
    onMessage: null, KINDS,
    init, reset, clear, spawn, add, near, label, startPickup, collect, lockTarget, startThrow, release, update,
    get count() { return items.length; },
    get list() { return items; }
  };
  G.Pickups = Pickups;
})(window.Game = window.Game || {});

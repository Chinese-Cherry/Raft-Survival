import * as THREE from 'three';
import { SHARK } from './let.js';

const TWO_PI = Math.PI * 2;

// 鲨鱼的"包络半径"：鲨鱼中心与木筏边缘至少保持这个水平距离，
// 否则鼻子/鱼鳍会插进木板里（模型从中心到鼻尖约 1.25 米，到尾巴约 1.6 米）。
const BODY_CLEARANCE = 1.45;

function normAngle(a) { return ((a % TWO_PI) + TWO_PI) % TWO_PI; }
function shortestAngle(from, to) {
  let d = normAngle(to - from);
  if (d > Math.PI) d -= TWO_PI;
  return d;
}

// 鲨鱼系统：
//  1) 开局就有一条鲨鱼在木筏周围游荡，并一直守在附近（不会再"来一次就走"）；
//  2) 每隔 SHARK.biteDelayMin ~ biteDelayMax 秒游向最外圈的一块木板啃咬；
//  3) 每 SHARK.biteInterval 秒咬一口，咬满 SHARK.bitesPerTile 口即咬烂该木板（从木筏上移除），
//     随后回到木筏周围继续游荡，等待下一次啃咬；
//  4) 玩家手持木矛靠近后左键攻击（Game 调用 hitTest / damage），命中 SHARK.health 次即击杀，
//     鲨鱼翻肚沉入海底，SHARK.respawnDelay 秒后再游来一条。
// 木筏刷新原点（Game._recenter）时需要调用 recenter()，否则鲨鱼会留在原地。
export class SharkSystem {
  constructor(scene, ocean, raft, onTileBroken) {
    this.scene = scene;
    this.ocean = ocean;
    this.raft = raft;
    this.onTileBroken = onTileBroken || null; // (gx, gz) => void：木板被咬烂时通知外面
    this.list = [];                            // 场上的鲨鱼（同时最多一条存活）
    this.respawnTimer = 0;                     // 被击杀后距下一条出现的剩余秒数
    this._spawn();                             // 开局就有一条在附近游荡
  }

  _rollBiteDelay() {
    const a = SHARK.biteDelayMin, b = Math.max(SHARK.biteDelayMin, SHARK.biteDelayMax);
    return a + Math.random() * (b - a);
  }

  // 是否正在啃咬木筏（用于界面警告）
  get biting() { return this.list.some((s) => s.state === 'bite'); }
  // 场上是否有鲨鱼
  get active() { return this.list.length > 0; }

  update(dt, t, playerPos) {
    // 鲨鱼被击杀后，等 respawnDelay 秒再放一条新的出来
    if (this.list.length === 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer > 0) return;
      this._spawn();
    }

    const [cgx, cgz] = this.raft.centerTile();
    const [cx, cz] = this.raft.gridToWorld(cgx, cgz);
    const R = this._raftRadius(cx, cz);
    for (const s of this.list.slice()) this._updateOne(s, dt, t, playerPos, cx, cz, R);
  }

  // 浮动原点回中：鲨鱼存在世界坐标里，必须跟着平移
  recenter(dx, dz) {
    for (const s of this.list) {
      s.group.position.x -= dx;
      s.group.position.z -= dz;
      if (s.target) { s.target.x -= dx; s.target.z -= dz; }
    }
  }

  // —— 木矛攻击 ——
  // 找出玩家前方 range 米内最近的一条鲨鱼；没有则返回 null。
  hitTest(origin, forward, range) {
    let best = null, bestD = range;
    for (const s of this.list) {
      if (s.state === 'dead') continue;
      const p = s.group.position;
      const dx = p.x - origin.x, dz = p.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      if (d > 0.01) {
        const dot = (dx * forward.x + dz * forward.z) / d;
        if (dot < 0.25) continue; // 必须大致在正前方
      }
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // 对鲨鱼造成伤害，返回是否击杀
  damage(s, n = SHARK.attackDamage) {
    if (!s || s.state === 'dead') return false;
    s.health -= n;
    s.flash = 0.3;
    this._setFlash(s, 1);
    if (s.health > 0) return false;

    // 击杀：停止啃咬，翻肚下沉
    s.state = 'dead';
    s.tile = null;
    s.target = null;
    if (s.tileMesh && s.tileOrig) s.tileMesh.position.copy(s.tileOrig);
    s.tileMesh = null;
    s.group.rotation.x = Math.PI; // 翻肚
    s.group.rotation.z = 0;
    return true;
  }

  // —— 内部：生成 / 更新 / 销毁 ——

  _spawn() {
    const [cgx, cgz] = this.raft.centerTile();
    const [cx, cz] = this.raft.gridToWorld(cgx, cgz);
    const R = this._raftRadius(cx, cz);
    const ang = Math.random() * TWO_PI;
    // 直接出现在木筏周围（游荡环上），看起来就是"一直守在这附近"
    const dist = R + Math.max(2, SHARK.roamRadius) + Math.random() * 3;

    const { group, tail } = this._buildMesh();
    group.position.set(
      cx + Math.cos(ang) * dist,
      this.ocean.surfaceY(cx, cz, 0) - 0.4,
      cz + Math.sin(ang) * dist
    );
    this.scene.add(group);

    const s = {
      group, tail,
      state: 'roam',           // roam（绕筏游荡）↔ bite（啃咬木板）；被击杀 → dead
      health: SHARK.health,
      heading: Math.atan2(cx - group.position.x, cz - group.position.z),
      target: null,            // 啃咬位置（世界坐标，动态更新）
      tile: null,              // 当前目标木板 { gx, gz, ox, oz }
      tileMesh: null,          // 目标木板网格（啃咬抖动用）
      tileOrig: null,          // 木板原始局部坐标
      shake: 0,
      chomp: 0,                // 咬合动作 0~1
      flash: 0,                // 受击闪红剩余时间
      bites: 0,                // 对当前木板已啃咬次数
      biteTimer: 0,
      roamAngle: ang,          // 绕筏游荡的当前角度
      biteDelay: this._rollBiteDelay(), // 距下次去啃木板的时间
      phase: Math.random() * TWO_PI,
    };
    group.rotation.y = s.heading;
    this.list.push(s);
  }

  _updateOne(s, dt, t, playerPos, cx, cz, R) {
    const g = s.group;
    const p = g.position;

    // 受击闪红
    if (s.flash > 0) {
      s.flash = Math.max(0, s.flash - dt);
      this._setFlash(s, s.flash * 3);
    }

    // 木板被啃咬时的抖动
    if (s.tileMesh && s.shake > 0) {
      s.shake = Math.max(0, s.shake - dt);
      const k = s.shake / 0.3;
      s.tileMesh.position.x = s.tileOrig.x + Math.sin(s.shake * 70) * 0.07 * k;
      s.tileMesh.position.z = s.tileOrig.z + Math.cos(s.shake * 63) * 0.07 * k;
      if (s.shake === 0) s.tileMesh.position.copy(s.tileOrig);
    }

    let moveDir = null;
    let speed = 0;

    switch (s.state) {
      case 'roam': {
        // 一直在木筏周围游荡：绕筏缓慢转圈，半径随时间轻微起伏
        const r = R + Math.max(2, SHARK.roamRadius) + Math.sin(t * 0.35 + s.phase) * 1.2;
        s.roamAngle += (Math.max(1.2, SHARK.roamSpeed) / Math.max(2, r)) * 0.75 * dt;
        const tx = cx + Math.cos(s.roamAngle) * r;
        const tz = cz + Math.sin(s.roamAngle) * r;
        moveDir = this._flatDir(p, { x: tx, z: tz });
        speed = SHARK.roamSpeed;

        // 游荡一段时间后，游向外圈木板啃咬
        s.biteDelay -= dt;
        if (s.biteDelay <= 0) {
          this._pickTarget(s, playerPos);
          if (s.tile) { s.state = 'bite'; s.biteTimer = 0; }
          else s.biteDelay = this._rollBiteDelay();
        }
        break;
      }
      case 'bite': {
        // 目标木板已被拆掉（或还没选）：重新挑一块最外圈木板
        if (!s.tile || !this.raft.hasTile(s.tile.gx, s.tile.gz)) this._pickTarget(s, playerPos);
        this._refreshTarget(s); // 跟随漂移中的木板
        if (!s.target) { s.state = 'roam'; s.biteDelay = 4; break; }
        if (this._flatDist(p, s.target) > 0.6) {
          moveDir = this._flatDir(p, s.target);
          speed = SHARK.approachSpeed;
        } else {
          s.biteTimer += dt;
          if (s.biteTimer >= Math.max(0.2, SHARK.biteInterval)) {
            s.biteTimer = 0;
            this._bite(s);
          }
        }
        break;
      }
      case 'dead': {
        p.y -= dt * 1.6;
        g.rotation.z += dt * 1.1;
        if (p.y < this.ocean.surfaceY(p.x, p.z, t) - 4) this._destroy(s);
        return;
      }
      default:
        break;
    }

    // —— 移动 + 平滑转向（模型 +Z 为前进方向） ——
    if (moveDir && speed > 0) {
      p.x += moveDir.x * speed * dt;
      p.z += moveDir.z * speed * dt;
      const want = Math.atan2(moveDir.x, moveDir.z);
      const maxStep = 2.6 * dt;
      s.heading = normAngle(s.heading + Math.max(-maxStep, Math.min(maxStep, shortestAngle(s.heading, want))));
    }

    // —— 不许穿进木筏：每帧兜底把鲨鱼推回水面 ——
    this._keepOutside(p);

    // —— 贴住海面（背部/背鳍露出水面） ——
    if (s.chomp > 0) s.chomp = Math.max(0, s.chomp - dt * 3);
    p.y = this.ocean.surfaceY(p.x, p.z, t) - 0.4 - s.chomp * 0.25;

    g.rotation.y = s.heading;
    g.rotation.z = Math.sin(t * 2.2 + s.phase) * 0.07;
    g.rotation.x = s.chomp * 0.35;                       // 咬合时低头
    if (s.tail) s.tail.rotation.y = Math.sin(t * 9 + s.phase) * 0.45; // 尾鳍摆动
  }

  // 啃一口：累计次数；咬满后拆掉这块木板，回到周围继续游荡
  _bite(s) {
    s.bites++;
    s.chomp = 1;

    const mesh = this.raft.tiles.get(this.raft.key(s.tile.gx, s.tile.gz));
    if (mesh && !s.tileMesh) {
      s.tileMesh = mesh;
      s.tileOrig = mesh.position.clone();
    }
    s.shake = 0.3;

    if (s.bites < Math.max(1, SHARK.bitesPerTile)) return;

    // 咬烂：从木筏上移除这块木板
    const { gx, gz } = s.tile;
    s.tileMesh = null;
    s.tileOrig = null;
    s.tile = null;
    s.target = null;
    if (this.raft.removeTile(gx, gz) && this.onTileBroken) this.onTileBroken(gx, gz);

    // 得手后回到木筏周围继续游荡，过一段时间再来
    const p = s.group.position;
    const [cgx, cgz] = this.raft.centerTile();
    const [cx, cz] = this.raft.gridToWorld(cgx, cgz);
    s.roamAngle = Math.atan2(p.z - cz, p.x - cx);
    s.biteDelay = this._rollBiteDelay();
    s.biteTimer = 0;
    s.state = 'roam';
  }

  // 选一块最外圈木板作为啃咬目标：取离鲨鱼最近的那块，
  // 尽量避开玩家正站着的格子（不然会把人直接咬进水里）。
  _pickTarget(s, playerPos) {
    const p = s.group.position;
    const cands = this.raft.outerTiles();
    if (!cands.length) { s.target = null; s.tile = null; return; }

    let pool = cands;
    if (playerPos) {
      const [pgx, pgz] = this.raft.worldToGrid(playerPos.x, playerPos.z);
      const safe = cands.filter((c) => !(c.gx === pgx && c.gz === pgz));
      if (safe.length) pool = safe;
    }

    let best = pool[0], bestD = Infinity;
    for (const c of pool) {
      const [wx, wz] = this.raft.gridToWorld(c.gx, c.gz);
      const d = Math.hypot(wx - p.x, wz - p.z);
      if (d < bestD) { bestD = d; best = c; }
    }

    // 换目标：把上一块木板的抖动复位，并重新绑定网格
    if (s.tileMesh && s.tileOrig) s.tileMesh.position.copy(s.tileOrig);
    s.tileMesh = null;
    s.tileOrig = null;
    s.shake = 0;

    const outLen = Math.hypot(best.dx, best.dz) || 1;
    s.tile = { gx: best.gx, gz: best.gz, ox: best.dx / outLen, oz: best.dz / outLen };
    s.bites = 0;
    s.biteTimer = 0;
    this._refreshTarget(s);
  }

  // 把目标点刷到木板当前的世界位置（木筏一直在漂移/航行，不能只在选目标时算一次）。
  // 位置取在"木板外沿 + 鲨鱼包络半径"之外，保证贴上去啃咬时鼻子刚好碰到木板而不穿模。
  _refreshTarget(s) {
    if (!s.tile) { s.target = null; return; }
    const [wx, wz] = this.raft.gridToWorld(s.tile.gx, s.tile.gz);
    const off = this.raft.tileSize * 0.5 + BODY_CLEARANCE + 0.05;
    if (!s.target) s.target = new THREE.Vector3();
    s.target.set(wx + s.tile.ox * off, 0, wz + s.tile.oz * off);
  }

  // 防穿模：求出鲨鱼中心到所有甲板格（木板 + 渔网）的最近距离，
  // 小于 BODY_CLEARANCE 就沿最近方向推出去。木筏在漂移、鲨鱼在追逐目标，
  // 单靠"目标点选在外面"仍可能从拐角/内侧切进去，这里每帧兜底。
  _keepOutside(p) {
    const half = this.raft.tileSize * 0.5;
    let bestD = Infinity;
    let bestX = 0, bestZ = 0, offX = 0, offZ = 0;

    for (const key of this.raft.deckKeys()) {
      const [gx, gz] = key.split(',').map(Number);
      const [wx, wz] = this.raft.gridToWorld(gx, gz);
      // 格子 AABB 上的最近点
      const qx = Math.max(wx - half, Math.min(wx + half, p.x));
      const qz = Math.max(wz - half, Math.min(wz + half, p.z));
      const dx = p.x - qx, dz = p.z - qz;
      const d = Math.hypot(dx, dz);
      if (d < bestD) {
        bestD = d;
        bestX = wx; bestZ = wz;
        offX = dx; offZ = dz;
      }
    }

    if (!Number.isFinite(bestD) || bestD >= BODY_CLEARANCE) return;

    if (bestD > 1e-4) {
      // 正常情况：从最近点沿径向推出到包络半径
      const push = BODY_CLEARANCE - bestD;
      p.x += (offX / bestD) * push;
      p.z += (offZ / bestD) * push;
    } else {
      // 极端情况（中心已落在格子内部）：沿最短轴推到格子外侧
      const ox = p.x - bestX, oz = p.z - bestZ;
      if (Math.abs(ox) >= Math.abs(oz)) {
        p.x = bestX + Math.sign(ox || 1) * (half + BODY_CLEARANCE);
      } else {
        p.z = bestZ + Math.sign(oz || 1) * (half + BODY_CLEARANCE);
      }
    }
  }

  _raftRadius(cx, cz) {
    let r = 0;
    for (const key of this.raft.tiles.keys()) {
      const [gx, gz] = key.split(',').map(Number);
      const [wx, wz] = this.raft.gridToWorld(gx, gz);
      const d = Math.hypot(wx - cx, wz - cz);
      if (d > r) r = d;
    }
    return r + this.raft.tileSize * 0.5;
  }

  _flatDir(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  _flatDist(from, to) { return Math.hypot(to.x - from.x, to.z - from.z); }

  _setFlash(s, v) {
    const k = Math.max(0, Math.min(1, v));
    s.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.emissive.setRGB(k * 0.7, k * 0.06, k * 0.04);
      }
    });
  }

  _destroy(s) {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    if (s.tileMesh && s.tileOrig) s.tileMesh.position.copy(s.tileOrig);
    // 被击杀沉入海底：过一段时间再放一条新的，保证木筏周围一直有鲨鱼
    if (s.state === 'dead') this.respawnTimer = Math.max(1, SHARK.respawnDelay);
    this.scene.remove(s.group);
    s.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else if (o.material) o.material.dispose();
    });
  }

  // —— 低多边形鲨鱼模型（+Z 为前进方向，背鳍露出水面） ——
  _buildMesh() {
    const group = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d4f5e, roughness: 0.8 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xd7e0e6, roughness: 0.9 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0b0f12, roughness: 0.4 });

    // 身体（椭球，长 2.5 / 宽 1 / 高 1.1）
    const bodyGeo = new THREE.SphereGeometry(1, 16, 12);
    bodyGeo.scale(0.52, 0.55, 1.25);
    const body = new THREE.Mesh(bodyGeo, dark);
    body.position.y = 0.05;
    group.add(body);

    // 腹部浅色
    const bellyGeo = new THREE.SphereGeometry(1, 14, 10);
    bellyGeo.scale(0.46, 0.34, 1.1);
    const bellyMesh = new THREE.Mesh(bellyGeo, belly);
    bellyMesh.position.set(0, -0.22, 0.05);
    group.add(bellyMesh);

    // 背鳍（三棱锥压扁）
    const finGeo = new THREE.ConeGeometry(0.42, 0.92, 3);
    finGeo.scale(1, 1, 0.22);
    const dorsal = new THREE.Mesh(finGeo, dark);
    dorsal.position.set(0, 0.78, -0.05);
    dorsal.rotation.x = -0.12;
    group.add(dorsal);

    // 尾鳍（挂在枢轴上，随游动摆动）
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.1, -1.1);
    const tailGeo = new THREE.ConeGeometry(0.5, 1.0, 3);
    tailGeo.scale(1, 1, 0.18);
    const tail = new THREE.Mesh(tailGeo, dark);
    tail.position.set(0, 0, -0.45);
    tail.rotation.x = -Math.PI / 2; // 锥尖朝 -Z（后方）
    tailPivot.add(tail);
    group.add(tailPivot);

    // 胸鳍（左右各一）
    const pectGeo = new THREE.ConeGeometry(0.34, 0.74, 3);
    pectGeo.scale(1, 1, 0.16);
    for (const side of [1, -1]) {
      const f = new THREE.Mesh(pectGeo, dark);
      f.position.set(side * 0.4, -0.14, 0.4);
      f.rotation.z = side * (Math.PI / 2 + 0.3);
      f.rotation.x = 0.35;
      group.add(f);
    }

    // 眼睛
    const eyeGeo = new THREE.SphereGeometry(0.075, 8, 8);
    for (const side of [1, -1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(side * 0.27, 0.18, 0.98);
      group.add(e);
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { group, tail: tailPivot };
  }
}

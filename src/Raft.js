import * as THREE from 'three';
import { CFG } from './let.js';

const TILE = 2; // 单个木筏格子的世界尺寸
const TWO_PI = Math.PI * 2;

// yaw → 单位方向向量（约定与玩家一致：yaw=0 朝向 -Z）
function dirFromYaw(yaw) {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}
// 角度归一化到 [0, 2π)
function normalizeAngle(a) {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}
// from → to 的最短角度差（-π ~ π）
function shortestAngle(from, to) {
  let d = normalizeAngle(to - from);
  if (d > Math.PI) d -= TWO_PI;
  return d;
}

// 木筏：以整数网格 (gx, gz) 维护已铺设的格子，可动态扩建。
export class Raft {
  constructor(scene) {
    this.scene = scene;
    this.tiles = new Map(); // key "gx,gz" -> Mesh
    this.walls = new Map(); // key "gx,gz,dx,dz" -> { gx, gz, dx, dz, lx, lz, mesh }
    this.netCells = new Map(); // key "gx,gz" -> 渔网网格（与木筏格子同等：可踩、可瞄准、可向外扩建）
    this.netMeshes = [];       // 渔网的可瞄准网格（建造射线用）
    this.tileSize = TILE;
    this.wallWidth = 1.8;   // 墙宽（沿墙长边）
    this.wallHeight = 1.6;  // 墙高
    this.wallThick = 0.3;   // 墙厚（薄边，朝向偏移方向）
    this.group = new THREE.Group();
    scene.add(this.group);

    // 木筏整体在海面上的世界偏移与运动
    this.offset = new THREE.Vector3(0, 0, 0);
    this.delta = new THREE.Vector3(0, 0, 0); // 本帧木筏位移，供玩家同步
    this.velocity = new THREE.Vector3();      // 本帧实际速度（update 中计算）
    this.currentDir = new THREE.Vector3(0.6, 0, 0.4).normalize(); // 洋流方向（= 漂浮物方向）
    this.driftSpeed = CFG.raftDriftSpeed;  // 无帆/收帆：随洋流漂移，略快于漂浮物(1~2)
    this.sailSpeed = CFG.raftSailSpeed;     // 扬帆：按船帆固定航向航行
    this.hasSail = false;
    this.sailMesh = null;
    this.sailCloth = null;                  // 帆布（收帆时隐藏）
    this.sailOpen = false;                  // 船帆是否展开
    this.sailYaw = 0;                       // 船帆固定航向（yaw，可通过互动修改）
    this.sailPreviewYaw = null;             // 调整航向时的预览朝向（null=不预览）
    this.sailPower = 0;                     // 帆力 0~1：航速从漂移速度缓慢爬升到峰值
    this.sailHeading = Math.atan2(-this.currentDir.x, -this.currentDir.z); // 当前实际航向（缓慢转向）

    // 起始 3x3 木筏
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) this.addTile(x, z);
  }

  key(gx, gz) { return `${gx},${gz}`; }
  worldToGrid(x, z) { return [Math.round((x - this.offset.x) / TILE), Math.round((z - this.offset.z) / TILE)]; }
  gridToWorld(gx, gz) { return [this.offset.x + gx * TILE, this.offset.z + gz * TILE]; } // 世界坐标
  gridToLocal(gx, gz) { return [gx * TILE, gz * TILE]; } // 相对 group 的局部坐标
  hasTile(gx, gz) { return this.tiles.has(this.key(gx, gz)); }

  // —— 渔网格子：外框与木筏格子同尺寸，可踩、可作为建造基准 ——
  hasNetCell(gx, gz) { return this.netCells.has(this.key(gx, gz)); }
  addNetCell(gx, gz, mesh) {
    this.netCells.set(this.key(gx, gz), mesh);
    if (mesh && !this.netMeshes.includes(mesh)) this.netMeshes.push(mesh);
  }
  // 可站立/可瞄准的甲板格：木筏格子 + 渔网格子
  isDeck(gx, gz) { return this.hasTile(gx, gz) || this.hasNetCell(gx, gz); }
  // 建造射线要检测的对象：木筏格子 + 渔网（渔网为 Group，需要递归检测子网格）
  aimTargets() { return [...this.tiles.values(), ...this.netMeshes]; }

  addTile(gx, gz) {
    if (this.isDeck(gx, gz)) return false; // 木筏格子与渔网互不重叠
    const geo = new THREE.BoxGeometry(TILE * 0.99, 0.3, TILE * 0.99);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
    const m = new THREE.Mesh(geo, mat);
    const [lx, lz] = this.gridToLocal(gx, gz);
    m.position.set(lx, -0.15, lz);
    m.receiveShadow = true;
    m.castShadow = true;
    this.group.add(m);
    this.tiles.set(this.key(gx, gz), m);
    return true;
  }

  // —— 木墙：建在格子的正东/西/南/北边缘，薄边朝向偏移方向 ——
  wallKey(gx, gz, dx, dz) { return `${gx},${gz},${dx},${dz}`; }
  hasWall(gx, gz, dx, dz) { return this.walls.has(this.wallKey(gx, gz, dx, dz)); }

  // 墙相对 group 的局部姿态：位置在格心沿偏移方向 TILE/2 处
  wallPose(gx, gz, dx, dz) {
    const [lx, lz] = this.gridToLocal(gx, gz);
    const half = TILE / 2;
    return { x: lx + dx * half, z: lz + dz * half, rotY: dx !== 0 ? Math.PI / 2 : 0 };
  }

  addWall(gx, gz, dx, dz) {
    const key = this.wallKey(gx, gz, dx, dz);
    if (this.walls.has(key)) return null;
    const p = this.wallPose(gx, gz, dx, dz);
    const geo = new THREE.BoxGeometry(this.wallWidth, this.wallHeight, this.wallThick);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x6f4a22, roughness: 1 })
    );
    mesh.position.set(p.x, this.wallHeight / 2, p.z);
    mesh.rotation.y = p.rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // 碰撞盒尺寸 = 模型尺寸（直接取几何体参数 × 当前缩放），保证碰撞与外观一致
    const gp = geo.parameters || { width: this.wallWidth, height: this.wallHeight, depth: this.wallThick };
    const wall = {
      gx, gz, dx, dz, lx: p.x, lz: p.z, mesh,
      halfW: (gp.width / 2) * mesh.scale.x,   // 沿墙长边（切向）的半宽
      halfH: (gp.height / 2) * mesh.scale.y,  // 高度的一半
      halfT: (gp.depth / 2) * mesh.scale.z,   // 薄边（法向）的半厚
    };
    this.walls.set(key, wall);
    return wall;
  }

  // 木墙碰撞：玩家视为半径 r 的竖直圆柱，与墙的 OBB（尺寸取自模型）求解。
  //  - 圆 vs 矩形：取矩形上的"最近点"，沿最近点→圆心的方向推出（角落按径向推开，
  //    贴面时沿法线滑动），因此墙与墙角之间不会出现可钻的缝隙；
  //  - 扫掠判定：用上一帧位置检测是否跨过了墙的薄面，避免高速/低帧率穿透；
  //  - 圆心陷入矩形内部时，沿最小穿透轴推出。
  // prevX/prevZ：本帧移动前的世界坐标（用于扫掠）。
  resolveWalls(pos, r = 0.35, feetY = -Infinity, headY = Infinity, prevX = pos.x, prevZ = pos.z) {
    if (this.walls.size === 0) return;
    const baseY = this.group.position.y; // 筏面（= 墙底）
    if (feetY < baseY - 0.6) return;     // 人在水里：不挡游泳

    for (const w of this.walls.values()) {
      // 高度不重叠：从墙顶上方经过 / 从下方通过
      const topY = baseY + w.halfH * 2;
      if (headY <= baseY + 0.05 || feetY >= topY - 0.05) continue;

      const cx = this.offset.x + w.lx, cz = this.offset.z + w.lz;
      const nx = w.dx, nz = w.dz;   // 法线：薄边朝向的偏移方向
      const tx = -nz, tz = nx;      // 切线：墙长边方向

      const relX = pos.x - cx, relZ = pos.z - cz;
      const pn = relX * nx + relZ * nz; // 当前法向坐标（相对墙心）
      const pt = relX * tx + relZ * tz; // 当前切向坐标

      // 1) 扫掠：上一帧在法向外侧、这一帧越到另一侧 → 挡回进入的那一侧
      const prevXr = prevX - cx, prevZr = prevZ - cz;
      const pn0 = prevXr * nx + prevZr * nz;
      const pt0 = prevXr * tx + prevZr * tz;
      const hn = w.halfT + r;   // 法向膨胀后的半厚
      const ht = w.halfW + r;   // 切向膨胀后的半宽
      if (Math.abs(pt0) <= ht && Math.abs(pn0) > w.halfT && Math.abs(pn) <= w.halfT
        && Math.sign(pn0) !== Math.sign(pn)) {
        const s = Math.sign(pn0) || 1;
        pos.x += nx * (s * hn - pn);
        pos.z += nz * (s * hn - pn);
        continue;
      }

      if (Math.abs(pn) >= hn || Math.abs(pt) >= ht) continue; // 未接触

      // 2) 圆 vs 矩形：最近点（钳制到矩形范围内）
      const qn = Math.max(-w.halfT, Math.min(w.halfT, pn));
      const qt = Math.max(-w.halfW, Math.min(w.halfW, pt));
      const on = pn - qn; // 最近点 → 圆心的法向分量
      const ot = pt - qt; // 最近点 → 圆心的切向分量
      const dist = Math.hypot(on, ot);

      if (dist > 1e-6) {
        if (dist >= r) continue;       // 最近点在半径外：确实没接触
        const push = r - dist;         // 径向推出去的深度
        const ux = on / dist, ut = ot / dist;
        pos.x += (ux * nx + ut * tx) * push;
        pos.z += (ux * nz + ut * tz) * push;
      } else {
        // 3) 圆心已在矩形内部：沿最小穿透轴推出
        const penN = hn - Math.abs(pn);
        const penT = ht - Math.abs(pt);
        if (penN <= penT) {
          const s = pn >= 0 ? 1 : -1;
          pos.x += nx * s * penN; pos.z += nz * s * penN;
        } else {
          const s = pt >= 0 ? 1 : -1;
          pos.x += tx * s * penT; pos.z += tz * s * penT;
        }
      }
    }
  }

  // 建造船帆：装上后可操作航行（按船帆固定航向移动）。只建一次。
  // lx/lz：相对 raft.group 的局部坐标（木筏上的任意位置，不必在格子中心）。
  addSail(lx = 0, lz = 0) {
    if (this.hasSail) return false;
    this.hasSail = true;
    this.sailOpen = true; // 建成即展开
    // 初始航向 = 当前洋流方向
    this.sailYaw = Math.atan2(-this.currentDir.x, -this.currentDir.z);
    const g = new THREE.Group();
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x5a3a1a })
    );
    mast.position.y = 1.5;
    g.add(mast);
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xf0ead6, side: THREE.DoubleSide, roughness: 1 })
    );
    sail.position.set(0, 2.0, 0);
    g.add(sail);
    g.position.set(lx, 0, lz);
    this.group.add(g);
    this.sailMesh = g;
    this.sailCloth = sail;
    return true;
  }

  // 船帆目标航向（单位向量）：yaw 约定与玩家一致
  sailDirection() {
    return dirFromYaw(this.sailYaw);
  }

  // 缓慢转向：每帧最多转 CFG.sailTurnSpeed * dt 弧度，避免航向瞬变导致速度突变
  turnToYaw(targetYaw, dt) {
    const maxStep = Math.max(0, CFG.sailTurnSpeed) * dt;
    const diff = shortestAngle(this.sailHeading, targetYaw);
    this.sailHeading = normalizeAngle(this.sailHeading + Math.max(-maxStep, Math.min(maxStep, diff)));
  }

  // 展开/收起船帆：收起后帆布隐藏，木筏恢复随洋流漂移
  setSailOpen(open) {
    if (!this.hasSail) return;
    this.sailOpen = !!open;
    if (this.sailCloth) this.sailCloth.visible = this.sailOpen;
  }

  // 直接设定船帆固定航向（玩家确认朝向时调用，yaw 约定与玩家一致）
  setSailYaw(yaw) {
    if (!this.hasSail) return;
    const twoPi = Math.PI * 2;
    this.sailYaw = (((yaw % twoPi) + twoPi) % twoPi);
  }

  // 判断世界坐标是否落在可站立的甲板上（木筏格子或渔网）。
  isOnRaft(x, z) {
    const [gx, gz] = this.worldToGrid(x, z);
    return this.isDeck(gx, gz);
  }

  // 世界坐标是否严格位于某块甲板格（木筏格/渔网）内（超出格子边缘一点也算超出）。
  containsPoint(x, z) {
    const [gx, gz] = this.worldToGrid(x, z);
    if (!this.isDeck(gx, gz)) return false;
    const [cx, cz] = this.gridToWorld(gx, gz);
    const half = TILE * 0.49; // 与木筏格渲染尺寸（0.99*TILE）一致
    return Math.abs(x - cx) <= half && Math.abs(z - cz) <= half;
  }

  // 所有甲板格（木筏格子 + 渔网）的网格键
  deckKeys() { return [...this.tiles.keys(), ...this.netCells.keys()]; }

  // 到木筏边缘（按格子范围而不是格心）的水平最短距离；已站在筏面上时为 0
  distanceTo(x, z) {
    let best = Infinity;
    const half = TILE / 2;
    for (const key of this.deckKeys()) {
      const [gx, gz] = key.split(',').map(Number);
      const [cx, cz] = this.gridToWorld(gx, gz);
      const dx = Math.max(Math.abs(x - cx) - half, 0);
      const dz = Math.max(Math.abs(z - cz) - half, 0);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
    return best;
  }

  // 最靠近木筏几何中心的甲板格（传送回木筏时的落点）
  centerTile() {
    const keys = this.deckKeys();
    let sx = 0, sz = 0, n = 0;
    for (const key of keys) {
      const [gx, gz] = key.split(',').map(Number);
      sx += gx; sz += gz; n++;
    }
    if (n === 0) return [0, 0];
    const ax = sx / n, az = sz / n;
    let best = [0, 0], bestD = Infinity;
    for (const key of keys) {
      const [gx, gz] = key.split(',').map(Number);
      const d = (gx - ax) ** 2 + (gz - az) ** 2;
      if (d < bestD) { bestD = d; best = [gx, gz]; }
    }
    return best;
  }

  update(ocean, t, dt, player) {
    if (dt === undefined) dt = 0;
    // 本帧航行/漂移方向：船帆朝向也使用它（必须在分支外声明，供后面引用）
    let dir = this.currentDir;
    if (CFG.Debug) {
      // 调试模式：木筏不漂移，仅随海面起伏（站在筏上的玩家也不被带走）
      this.velocity.set(0, 0, 0);
      this.delta.set(0, 0, 0);
    } else {
      // 速度：扬帆后沿船帆固定航向航行，航速从漂移速度缓慢爬升到峰值；
      // 无帆/收帆时帆力逐渐回落，最终恢复洋流漂移速度。
      const ramp = Math.max(0.01, CFG.sailRampTime); // 爬升到峰值所需时间（秒）
      const driftYaw = Math.atan2(-this.currentDir.x, -this.currentDir.z);
      if (this.hasSail && this.sailOpen) {
        // 扬帆：航向缓慢转向船帆设定方向，速度缓慢爬升
        this.turnToYaw(this.sailYaw, dt);
        this.sailPower = Math.min(1, this.sailPower + dt / ramp);
        dir = dirFromYaw(this.sailHeading);
      } else {
        // 收帆：速度缓慢回落，航向缓慢转回洋流方向
        this.sailPower = Math.max(0, this.sailPower - dt / ramp);
        this.turnToYaw(driftYaw, dt);
        dir = this.hasSail ? dirFromYaw(this.sailHeading) : this.currentDir;
      }
      // 速度参数每帧从 CFG 读取（改 let.js 里的 raftDriftSpeed / raftSailSpeed 即时生效）
      this.driftSpeed = CFG.raftDriftSpeed;
      this.sailSpeed = CFG.raftSailSpeed;   // 船帆速度上限（峰值航速）
      const speed = Math.min(
        this.sailSpeed,
        this.driftSpeed + (this.sailSpeed - this.driftSpeed) * this.sailPower
      );
      this.velocity.copy(dir).multiplyScalar(speed);

      // 木筏整体平移，站在筏上的玩家会被一起带着走
      const nx = this.offset.x + this.velocity.x * dt;
      const nz = this.offset.z + this.velocity.z * dt;
      this.delta.set(nx - this.offset.x, 0, nz - this.offset.z);
      this.offset.set(nx, 0, nz);
    }
    this.group.position.x = this.offset.x;
    this.group.position.z = this.offset.z;
    // 木筏整体骑在海面上：跟随所在位置的海面高度起伏
    this.group.position.y = ocean.surfaceY(this.offset.x, this.offset.z, t) + 0.3;

    // 船帆朝向：调整航向时预览玩家朝向；否则朝向当前航向
    if (this.sailMesh) {
      const d = this.sailPreviewYaw !== null
        ? new THREE.Vector3(-Math.sin(this.sailPreviewYaw), 0, -Math.cos(this.sailPreviewYaw))
        : dir;
      this.sailMesh.rotation.y = Math.atan2(d.x, d.z);
    }
  }
}

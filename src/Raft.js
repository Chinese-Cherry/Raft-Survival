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
    this.tileSize = TILE;
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

  addTile(gx, gz) {
    if (this.hasTile(gx, gz)) return false;
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

  // 找到玩家附近、与现有木筏相邻的空格子（用于建造预览/放置）。
  nearestEmptyNeighbor(px, pz) {
    const [gx, gz] = this.worldToGrid(px, pz);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dz] of dirs)
      if (!this.hasTile(gx + dx, gz + dz)) return [gx + dx, gz + dz];
    return null;
  }

  // 判断世界坐标是否落在木筏上（玩家是否"站在筏上"）。
  isOnRaft(x, z) {
    const [gx, gz] = this.worldToGrid(x, z);
    return this.hasTile(gx, gz);
  }

  // 世界坐标是否严格位于某块木筏格内（超出格子边缘一点也算超出）。
  containsPoint(x, z) {
    const [gx, gz] = this.worldToGrid(x, z);
    if (!this.hasTile(gx, gz)) return false;
    const [cx, cz] = this.gridToWorld(gx, gz);
    const half = TILE * 0.49; // 与木筏格渲染尺寸（0.99*TILE）一致
    return Math.abs(x - cx) <= half && Math.abs(z - cz) <= half;
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
      const speed = this.driftSpeed + (this.sailSpeed - this.driftSpeed) * this.sailPower;
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

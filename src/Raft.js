import * as THREE from 'three';
import { CFG } from './let.js';

const TILE = 2; // 单个木筏格子的世界尺寸

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
    this.driftSpeed = CFG.raftDriftSpeed;  // 无帆：随洋流漂移，略快于漂浮物(1~2)
    this.sailSpeed = CFG.raftSailSpeed;     // 有帆：按玩家朝向航行
    this.hasSail = false;
    this.sailMesh = null;

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
    const [wx, wz] = this.gridToWorld(gx, gz);
    m.position.set(wx, -0.15, wz);
    m.receiveShadow = true;
    m.castShadow = true;
    this.group.add(m);
    this.tiles.set(this.key(gx, gz), m);
    return true;
  }

  // 建造船帆：装上后可操作航行（按玩家朝向移动）。只建一次。
  addSail() {
    if (this.hasSail) return;
    this.hasSail = true;
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
    const [wx, wz] = this.gridToLocal(0, 0); // 立在木筏中心格
    g.position.set(wx, 0, wz);
    this.group.add(g);
    this.sailMesh = g;
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

  update(ocean, t, dt, player) {
    if (dt === undefined) dt = 0;
    if (CFG.Debug) {
      // 调试模式：木筏不漂移，仅随海面起伏（站在筏上的玩家也不被带走）
      this.velocity.set(0, 0, 0);
      this.delta.set(0, 0, 0);
    } else {
      // 速度：有帆则按玩家朝向航行；无帆则随洋流漂移（方向与漂浮物一致，略快）
      let dir, speed;
      if (this.hasSail && player) {
        dir = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).normalize();
        speed = this.sailSpeed;
      } else {
        dir = this.currentDir;
        speed = this.driftSpeed;
      }
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

    // 船帆朝向航行方向（调试模式下无平移，保持朝洋流方向即可）
    if (this.sailMesh) {
      const d = CFG.Debug ? this.currentDir : dir;
      this.sailMesh.rotation.y = Math.atan2(d.x, d.z);
    }
  }
}

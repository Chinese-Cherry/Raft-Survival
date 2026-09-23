import * as THREE from 'three';
import { CFG } from './let.js';

export const TYPES = {
  plastic: { color: 0x4fa3d1, label: '塑料', shape: 'model', radius: 0.55, model: 'plastic_sheet' },
  rope: { color: 0xc9b079, label: '绳索', shape: 'model', radius: 0.40, model: 'rope' },
  lumber: { color: 0x6f4a22, label: '木材', shape: 'model', radius: 0.55, model: 'wood_plank' },
  apple: { color: 0xd14f6a, label: '苹果', shape: 'model', radius: 0.45, model: 'apple' },
  banana: { color: 0xe6c84f, label: '香蕉', shape: 'model', radius: 0.45, model: 'banana' },
  orange: { color: 0xe08a2b, label: '橙子', shape: 'model', radius: 0.45, model: 'orange' },
  leaf:   { color: 0x2e7d32, label: '树叶', shape: 'model', radius: 0.5, model: 'leaf' },
};

// 漂浮资源系统：
//  - 水上漂浮：随海浪正弦起伏 + 跟随波面法线倾斜（浮力感）
//  - 水上移动：受洋流 + 随机扰动驱动漂移，越界自动回拉，避免漂走
export class Resources {
  constructor(scene, ocean, raft, inventory, viewDist, foodTemplates) {
    this.scene = scene;
    this.ocean = ocean;
    this.raft = raft;
    this.inv = inventory;
    this.foodTemplates = foodTemplates || {}; // 食物 FBX 模型模板（克隆使用）
    this.items = [];
    this.pickupRadius = 2.2;
    this.spawnTimer = 0;
    this.t = 0;

    // 视野外生成环与销毁半径（都基于视野距离，运行时由 CFG.viewDist 实时决定）
    this.viewDist = CFG.viewDist;
    this.current = new THREE.Vector3(0.6, 0, 0.4).normalize(); // 全局洋流方向（漂浮物大致同向）
    this.center = new THREE.Vector3(0, 0, 0); // 资源生成中心（随玩家/木筏移动）
    this.prevCenter = new THREE.Vector3();
    this.playerVel = new THREE.Vector3(); // 玩家（木筏）相对移动速度

    // 开局：在木筏附近生成一批漂浮物，便于立即收集
    for (let i = 0; i < CFG.startCount; i++) this.spawn({ near: true });
  }

  spawn(opts = {}) {
    const keys = Object.keys(TYPES);
    const type = keys[(Math.random() * keys.length) | 0];
    const def = TYPES[type];

    let mesh;
    if (def.shape === 'model' && this.foodTemplates[def.model]) {
      mesh = this.foodTemplates[def.model].clone(true); // 克隆共享几何体的食物模型
    } else if (def.shape === 'cyl') {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: def.color })
      );
    } else {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.4, 0.6),
        new THREE.MeshStandardMaterial({ color: def.color })
      );
    }
    mesh.castShadow = true;
    // 计算模型原生包围盒（未缩放），得到碰撞用的半长/半宽
    mesh.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(mesh);
    const bsize = new THREE.Vector3();
    bbox.getSize(bsize);
    const baseHalfX = bsize.x / 2, baseHalfZ = bsize.z / 2;
    const sc = CFG.floatScale[type];
    mesh.scale.setScalar(sc); // 漂浮物大小（按类型单独可调）

    // 生成位置：调试/开局时在木筏附近随机生成（便于观察与开局即有资源），
    // 否则在视野外的上游环生成（物品从前方迎面漂来）
    let spawnAng, dist;
    if (CFG.Debug || opts.near) {
      spawnAng = Math.random() * Math.PI * 2; // 木筏四周任意方向
      dist = CFG.startSpawnMin + Math.random() * (CFG.startSpawnMax - CFG.startSpawnMin);
    } else {
      // 生成方向：移动时取玩家前方 ±90°（迎面漂来）；静止时四周随机，保持环境始终充实
      if (this.playerVel.lengthSq() > 0.04) {
        const ang = Math.atan2(this.playerVel.z, this.playerVel.x);
        spawnAng = ang + (Math.random() - 0.5) * Math.PI;
      } else {
        spawnAng = Math.random() * Math.PI * 2; // 静止时四周都生成
      }
      const vd = CFG.viewDist;
      const spawnMin = vd + 4, spawnMax = vd + 22; // 视野外生成环（实时跟随视野）
      dist = spawnMin + Math.random() * (spawnMax - spawnMin);
    }
    // 避免生成在木筏格子上：若落在筏面上，沿同方向逐步外推直至离开木筏
    let px = this.center.x + Math.cos(spawnAng) * dist;
    let pz = this.center.z + Math.sin(spawnAng) * dist;
    for (let i = 0; i < 12 && this.raft.isOnRaft(px, pz); i++) {
      dist += this.raft.tileSize;
      px = this.center.x + Math.cos(spawnAng) * dist;
      pz = this.center.z + Math.sin(spawnAng) * dist;
    }
    mesh.position.set(px, 0, pz);

    // 每个漂浮物沿同一洋流方向、速度相近，仅叠加小幅随机扰动
    const speed = CFG.floatSpeedMin + Math.random() * (CFG.floatSpeedMax - CFG.floatSpeedMin);
    const drift = this.current.clone().multiplyScalar(speed)
      .add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4));

    const item = {
      type,
      mesh,
      baseHalfX, baseHalfZ,                        // 未缩放时包围盒的半长/半宽
      halfX: baseHalfX * sc,                       // 当前碰撞半长（随大小缩放）
      halfZ: baseHalfZ * sc,                       // 当前碰撞半宽（随大小缩放）
      disposable: def.shape !== 'model',          // 模型为克隆共享几何体，不可 dispose
      phase: Math.random() * Math.PI * 2,        // 起伏相位错开
      bobAmp: 0.25 + Math.random() * 0.15,        // 起伏幅度
      drift,                                      // 当前漂移速度（碰撞时改变）
      baseDrift: drift.clone(),                   // 原始漂移速度（停止接触后还原）
      wanderPhase: Math.random() * Math.PI * 2,
    };

    this.scene.add(mesh);
    this.items.push(item);
  }

  // 返回玩家可拾取的最近物体（用于提示与互动）。
  nearest(playerPos) {
    let best = null, bestD = this.pickupRadius;
    for (const it of this.items) {
      const d = it.mesh.position.distanceTo(playerPos);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  collect(it) {
    const idx = this.items.indexOf(it);
    if (idx === -1) return;
    this.inv.add(it.type, 1);
    this._remove(it);
    this.items.splice(idx, 1);
  }

  // 从场景移除并释放几何体（模型克隆共享几何体，仅释放一次性几何）
  _remove(it) {
    this.scene.remove(it.mesh);
    if (it.disposable) {
      it.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }

  // 近似碰撞：把漂浮物推出玩家/木筏格并反弹法向速度。返回本帧是否发生接触。
  // 反弹后速度大小不变（像弹性碰撞）；离开接触后由调用方逐渐还原到 baseDrift。
  _collide(it, player) {
    if (it.collideDisabled) return false; // 被钩锁钩住时取消碰撞
    const p = it.mesh.position;

    // 长方体碰撞盒：尺寸在生成时（渲染结束后）一次性按模型包围盒确定（baseHalfX/baseHalfZ）。
    // 运行时仅按网格绕 Y 的旋转得到有效半长/半宽，不逐帧调用 setFromObject 重建包围盒（避免卡顿）。
    it.mesh.updateMatrix();
    const e = it.mesh.matrix.elements;
    const ang = Math.atan2(e[8], e[0]);            // 绕 Y 旋转角（含波动倾斜近似）
    const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
    const hx = it.halfX * c + it.halfZ * s;        // 旋转后 AABB 半长
    const hz = it.halfX * s + it.halfZ * c;        // 旋转后 AABB 半宽
    let hit = false;

    // 1) 玩家：用模型半长/半宽做盒状碰撞（玩家视作半径 0.7 的圆柱，按 AABB 近似）
    const dxp = p.x - player.x, dzp = p.z - player.z;
    const bx = hx + 0.7, bz = hz + 0.7;
    const ox = bx - Math.abs(dxp), oz = bz - Math.abs(dzp);
    if (ox > 0 && oz > 0) {
      hit = true;
      if (ox < oz) {
        const nx = dxp >= 0 ? 1 : -1;
        p.x += nx * ox;
        if (it.drift.x * nx < 0) it.drift.x = -it.drift.x; // 法向全反射
        it.drift.x += nx * 0.2;
      } else {
        const nz = dzp >= 0 ? 1 : -1;
        p.z += nz * oz;
        if (it.drift.z * nz < 0) it.drift.z = -it.drift.z;
        it.drift.z += nz * 0.2;
      }
    }

    // 2) 木筏格子：半格方块 + 物体半长/半宽（全反射，保留原速）
    const [gx, gz] = this.raft.worldToGrid(p.x, p.z);
    if (this.raft.hasTile(gx, gz)) {
      const half = this.raft.tileSize * 0.48;
      const [cx, cz] = this.raft.gridToWorld(gx, gz);
      const dx = p.x - cx, dz = p.z - cz;
      if (Math.abs(dx) < half + hx && Math.abs(dz) < half + hz) {
        hit = true;
        const penX = half + hx - Math.abs(dx);
        const penZ = half + hz - Math.abs(dz);
        if (penX < penZ) {
          const s = dx >= 0 ? 1 : -1;
          p.x = cx + s * (half + hx);
          if (it.drift.x * s < 0) it.drift.x = -it.drift.x; // 法向全反射
          it.drift.x += s * 0.2;
        } else {
          const s = dz >= 0 ? 1 : -1;
          p.z = cz + s * (half + hz);
          if (it.drift.z * s < 0) it.drift.z = -it.drift.z;
          it.drift.z += s * 0.2;
        }
      }
    }

    // 全局限速，杜绝任何情况下无限加速飞走
    const maxV = 1.5;
    const sp = Math.hypot(it.drift.x, it.drift.z);
    if (sp > maxV) { it.drift.x *= maxV / sp; it.drift.z *= maxV / sp; }

    return hit;
  }

  update(dt, playerPos, t) {
    if (t === undefined) { this.t += dt; t = this.t; }
    this.t = t;
    if (playerPos) {
      // 由相邻帧玩家位移估算相对移动速度，供生成方向使用
      if (this.prevCenter.lengthSq() > 0)
        this.playerVel.copy(playerPos).sub(this.prevCenter).multiplyScalar(dt > 0 ? 1 / dt : 0);
      this.center.copy(playerPos);
      this.prevCenter.copy(playerPos);
    }

    const toRemove = [];
    for (const it of this.items) {
      // 运行时同步缩放（调试面板调大小实时生效）
      it.mesh.scale.setScalar(CFG.floatScale[it.type]);
      const sc = CFG.floatScale[it.type];
      it.halfX = it.baseHalfX * sc;
      it.halfZ = it.baseHalfZ * sc;

      // 被钩锁拉回中：位置由 Game 控制，这里仅保持贴在水面（仍参与越界销毁判断）
      if (it.pulling) {
        const wx = it.mesh.position.x, wz = it.mesh.position.z;
        it.mesh.position.y = this.ocean.surfaceY(wx, wz, t) + 0.12;
        continue;
      }

      // 调试模式：漂浮物不移动（不平移、不碰撞、不自旋），仅保持贴在水面上
      if (!CFG.Debug) {
        // —— 水上移动：漂移 + 缓慢随机游走 ——
        const wander = new THREE.Vector3(
          Math.sin(t * 0.3 + it.wanderPhase),
          0,
          Math.cos(t * 0.23 + it.wanderPhase)
        ).multiplyScalar(0.25);
        const vel = it.drift.clone().add(wander);

        it.mesh.position.x += vel.x * dt;
        it.mesh.position.z += vel.z * dt;

        // —— 近似碰撞：与玩家、木筏格互相阻挡 ——
        const hit = this._collide(it, playerPos);

        // 停止接触后，漂移速度逐渐还原到原始 baseDrift（像被弹开后恢复本来的漂流）
        if (!hit) {
          const k = 1 - Math.exp(-dt * 1.5);
          it.drift.x += (it.baseDrift.x - it.drift.x) * k;
          it.drift.z += (it.baseDrift.z - it.drift.z) * k;
        }

        // 跟随波面法线倾斜，模拟随浪摇摆
        const wx0 = it.mesh.position.x, wz0 = it.mesh.position.z;
        const hx = this.ocean.heightAt(wx0 + 0.5, wz0, t) - this.ocean.heightAt(wx0 - 0.5, wz0, t);
        const hz = this.ocean.heightAt(wx0, wz0 + 0.5, t) - this.ocean.heightAt(wx0, wz0 - 0.5, t);
        const normal = new THREE.Vector3(-hx, 1, -hz).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        it.mesh.quaternion.setFromUnitVectors(up, normal);
        it.mesh.rotateY(t * 0.2 + it.phase); // 叠加缓慢自旋
      }

      // —— 水上漂浮：贴紧真实海面高度（始终生效） ——
      const wx = it.mesh.position.x, wz = it.mesh.position.z;
      it.mesh.position.y = this.ocean.surfaceY(wx, wz, t) + 0.12;

      // 漂出视野范围则销毁（实时跟随视野）
      const d = Math.hypot(wx - playerPos.x, wz - playerPos.z);
      if (d > CFG.viewDist + 35) toRemove.push(it);
    }
    for (const it of toRemove) this._despawn(it);

    // 维持场上资源数量（漂出视野会销毁，这里持续补充），让游玩中感觉源源不断
    this.spawnTimer += dt;
    if (this.spawnTimer >= CFG.spawnInterval) {
      this.spawnTimer = 0;
      if (this.items.length < CFG.maxItems) this.spawn();
    }
  }

  // 离开视野后销毁（不计入背包）
  _despawn(it) {
    const idx = this.items.indexOf(it);
    if (idx === -1) return;
    this._remove(it);
    this.items.splice(idx, 1);
  }

  // 调试开关切换时调用：清空现有漂浮物并按当前 CFG.Debug 重新布置（近处/远处）
  resetForDebug() {
    for (const it of this.items.slice()) this._despawn(it);
    for (let i = 0; i < CFG.startCount; i++) this.spawn();
  }
}

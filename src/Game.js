import * as THREE from 'three';
import { Ocean } from './Ocean.js';
import { Raft } from './Raft.js';
import { Inventory } from './Inventory.js';
import { Crafting } from './Crafting.js';
import { Player } from './Player.js';
import { Resources } from './Resources.js';
import { UI } from './UI.js';
import { ITEMS } from './Items.js';
import { CFG } from './let.js';

// 游戏主控：装配场景/渲染器/光照，组织各子系统并驱动主循环与交互。
export class Game {
  constructor(foodModels) {
    this.canvas = document.getElementById('app');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ecbe8);
    this.viewDist = CFG.viewDist; // 视野距离上限（调试可调）
    this.edgeRadius = this.viewDist * 0.8; // 接近此半径即把世界拉回中心（浮动原点）
    this.scene.fog = new THREE.Fog(0x9ecbe8, this.viewDist * 0.5, this.viewDist);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, this.viewDist + 90);

    // 光照
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a3a4a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    this.scene.add(sun);

    // 子系统
    this.ocean = new Ocean(this.scene);
    this.raft = new Raft(this.scene);
    this.inventory = new Inventory();
    this.crafting = new Crafting(this.inventory, (r) => this.onCraft(r));
    this.player = new Player(this.camera, this.canvas, this.raft);
    this.resources = new Resources(this.scene, this.ocean, this.raft, this.inventory, this.viewDist, foodModels);
    this.ui = new UI(this.inventory, this.crafting, this);

    this._setupBuildGhost();
    this._setupTools();
    this._bindInteractions();
    // 开局默认拥有钩锁（可制作），并直接装备
    this.inventory.add('hook_lock', 1);
    this._equip('hook_lock');
    this.ui.refreshCounts();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.clock = new THREE.Clock();
    this._loop();
  }

  // 运行时修改视野距离：同步相机远裁剪面、雾范围与浮动原点边界。
  applyViewDist(v) {
    this.viewDist = v;
    this.edgeRadius = v * 0.8;
    this.scene.fog.near = v * 0.5;
    this.scene.fog.far = v;
    this.camera.far = v + 90;
    this.camera.updateProjectionMatrix();
  }

  _setupBuildGhost() {
    const geo = new THREE.BoxGeometry(1.92, 0.3, 1.92);
    const mat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.4 });
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  _setupTools() {
    this.equipped = null;
    this.toolCooldown = 0;
    this.hook = null;      // 钩锁投射物状态（flying / pulling / retract）
    this.charging = null;  // 蓄力状态 { type, t }
    this.toolMsg = '';
    this.toolMsgTimer = 0;
    this.fishing = null;

    // 鱼竿可视化：钓线（相机→浮漂）+ 浮漂小球
    this.fishingLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    this.fishingLine.visible = false;
    this.scene.add(this.fishingLine);
    this.bobber = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5544 })
    );
    this.bobber.visible = false;
    this.scene.add(this.bobber);

    // 钩锁可视化：钩头小球 + 钩线（相机→钩头）
    this._hookMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xcfcfcf })
    );
    this._hookMesh.visible = false;
    this.scene.add(this._hookMesh);
    this.hookLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xaaaaaa })
    );
    this.hookLine.visible = false;
    this.scene.add(this.hookLine);
  }

  _bindInteractions() {
    document.addEventListener('mousedown', (e) => {
      if (this.ui.openPanel) return;
      if (e.button === 0) this._onLeftDown();  // 左键：使用道具（鱼竿/钩锁蓄力） / 建造
      if (e.button === 2) this._tryPickup();     // 右键：瞄准拾取
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._onLeftUp();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // —— 装备 / 使用 ——
  _equip(id) {
    if (id === null) { this.equipped = null; this.ui.setEquipped(null); return; }
    if (!this.inventory.has(id)) {
      this.ui.setPrompt(`尚未拥有 ${ITEMS[id]?.name || id}`);
      return;
    }
    this.equipped = id;
    this.ui.setEquipped(id);
  }

  // 鱼竿/钩锁走蓄力抛出流程（左键按下蓄力、松开抛出），这里只处理瞬时道具
  _useTool() {
    if (!this.equipped) { this.ui.setPrompt('未装备道具：按数字键选中快捷栏道具'); return; }
    if (this.toolCooldown > 0) return;
    switch (this.equipped) {
      case 'net':   this._useNet(); break;
      case 'spear': this._useSpear(); break;
    }
  }

  // 左键按下：装备了蓄力类道具则开始蓄力，否则立即使用；空手则建造
  _onLeftDown() {
    if (!this.player.locked) return;
    if (!this.equipped) { this._tryBuild(); return; }
    if (this.toolCooldown > 0) return;
    if (this.equipped === 'fishing_rod' || this.equipped === 'hook_lock') {
      this.charging = { type: this.equipped, t: 0 };
    } else {
      this._useTool();
    }
  }

  // 左键松开：按蓄力时长抛出鱼竿/钩锁
  _onLeftUp() {
    if (!this.charging) return;
    const charge = Math.min(1, this.charging.t / 1.0); // 蓄力 1 秒满
    const type = this.charging.type;
    this.charging = null;
    if (type === 'fishing_rod') this._useFishingRod(charge);
    else if (type === 'hook_lock') this._throwHook(charge);
  }

  _forward() {
    const y = this.player.yaw;
    return new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y)).normalize();
  }

  _nearestItemWithin(radius, inFront) {
    let best = null, bestD = radius;
    const fwd = this._forward();
    for (const it of this.resources.items) {
      const d = it.mesh.position.distanceTo(this.player.pos);
      if (d > radius) continue;
      if (inFront) {
        const to = it.mesh.position.clone().sub(this.player.pos).setY(0).normalize();
        if (to.dot(fwd) < 0.3) continue;
      }
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  _collectWithin(radius) {
    let n = 0;
    for (const it of this.resources.items.slice()) {
      if (it.mesh.position.distanceTo(this.player.pos) <= radius) {
        this.resources.collect(it);
        n++;
      }
    }
    return n;
  }

  // 🎣 鱼竿：左键蓄力后抛出，蓄力越久抛得越远；等待后钓上随机的鱼
  _useFishingRod(charge = 0) {
    if (this.fishing) return;
    const fwd = this._forward();
    const target = this.player.pos.clone().add(fwd.multiplyScalar(5 + charge * 10));
    target.y = 0.2;
    this.bobber.position.copy(target);
    this.bobber.visible = true;
    this.fishingLine.visible = true;
    this.fishing = { timer: 0, duration: 2.8, target };
    this._flash('🎣 抛竿！等待鱼儿上钩…', 0.4);
  }

  _updateFishing(dt) {
    if (!this.fishing) return;
    this.fishing.timer += dt;
    const tt = performance.now() / 1000;
    this.bobber.position.y = 0.2 + Math.sin(tt * 3) * 0.08;
    const pos = this.fishingLine.geometry.attributes.position;
    pos.setXYZ(0, this.camera.position.x, this.camera.position.y - 0.3, this.camera.position.z);
    pos.setXYZ(1, this.bobber.position.x, this.bobber.position.y, this.bobber.position.z);
    pos.needsUpdate = true;
    if (this.fishing.timer >= this.fishing.duration) {
      const lootPool = ['fish_small', 'bass', 'pufferfish', 'salmon', 'tuna'];
      const loot = lootPool[Math.floor(Math.random() * lootPool.length)];
      this.inventory.add(loot, 1);
      this.ui.refreshCounts();
      this._flash(`🎣 钓到了 ${ITEMS[loot].name}！`, 2.0);
      this.bobber.visible = false;
      this.fishingLine.visible = false;
      this.fishing = null;
      this.toolCooldown = 0.5;
    }
  }

  // 🪝 钩锁：左键蓄力后抛出，沿玩家视角（含俯仰）做抛物线飞出；
  // 飞行中碰到漂浮物即钩住（取消碰撞），落到海面时开始拉回，最终全部直接收入背包。
  _throwHook(charge = 0) {
    if (this.hook && this.hook.active) return;
    const dir = this.camera.getWorldDirection(new THREE.Vector3()).normalize(); // 含玩家垂直朝向
    const speed = (16 + charge * 18) * CFG.hookForce; // 蓄力越久抛得越远；hookForce 等比缩放总力度
    this.hook = {
      active: true,
      phase: 'flying',                       // flying → pulling → (retract)
      dir: dir.clone(),
      vel: dir.clone().multiplyScalar(speed),// 初速度（抛物线）
      pos: this.camera.position.clone().add(dir.clone().multiplyScalar(0.6)),
      gravity: 18,
      traveled: 0,
      maxDist: 6 + charge * 18,              // 安全上限：飞太远则拉回
      flightTime: 0,
      items: [],
      pulled: 0,
    };
    this._hookMesh.visible = true;
    this.hookLine.visible = true;
    this._flash('🪝 抛出钩锁…', 0.5);
  }

  _hookItem(it) {
    it.pulling = true;          // 暂停自身漂移（Resources.update 跳过）
    it.collideDisabled = true;  // 取消碰撞
    this.hook.items.push(it);
  }

  _syncHooked() {
    const h = this.hook;
    for (let i = 0; i < h.items.length; i++) {
      const back = h.dir.clone().multiplyScalar(-(0.9 + i * 0.7));
      const it = h.items[i];
      it.mesh.position.x = h.pos.x + back.x;
      it.mesh.position.z = h.pos.z + back.z;
    }
  }

  _updateHook(dt, t) {
    const h = this.hook;
    if (!h || !h.active) return;

    if (h.phase === 'flying') {
      // 抛物线：初速度受重力影响，方向已含玩家俯仰（垂直朝向）
      h.vel.y -= h.gravity * dt;
      h.pos.add(h.vel.clone().multiplyScalar(dt));
      h.traveled += h.vel.length() * dt;
      h.flightTime += dt;
      this._hookMesh.position.copy(h.pos);
      // 飞行中碰到漂浮物即钩住（取消其碰撞）
      for (const it of this.resources.items) {
        if (h.items.includes(it) || it.pulling) continue;
        if (it.mesh.position.distanceTo(h.pos) < 1.3) {
          this._hookItem(it);
          this._flash(`🪝 钩住了 ${ITEMS[it.type].name}`, 1.0);
          h.phase = 'pulling';
          break;
        }
      }
      // 落到海面 → 才开始拉回（只有碰到海平面才收回）
      const seaY = this.ocean.surfaceY(h.pos.x, h.pos.z, t);
      if (h.pos.y <= seaY + 0.1) {
        h.pos.y = seaY + 0.1;
        h.phase = 'pulling';
      }
    } else if (h.phase === 'pulling') {
      const pullTarget = this.player.pos.clone().add(this._forward().multiplyScalar(1.5));
      pullTarget.y = this.ocean.surfaceY(pullTarget.x, pullTarget.z, t); // 收回到海平面，而非直飞相机位置
      h.pos.lerp(pullTarget, Math.min(1, dt * 4));
      this._hookMesh.position.copy(h.pos);
      // 拉回途中钩住路径上/附近的其他漂浮物
      for (const it of this.resources.items) {
        if (h.items.includes(it) || it.pulling) continue;
        let near = it.mesh.position.distanceTo(h.pos) < 1.3;
        if (!near) {
          for (const hi of h.items) {
            if (it.mesh.position.distanceTo(hi.mesh.position) < 1.6) { near = true; break; }
          }
        }
        if (near) { this._hookItem(it); this._flash(`🪝 又钩住了 ${ITEMS[it.type].name}`, 1.0); }
      }
      this._syncHooked();
      h.pulled += dt;
      if (h.pos.distanceTo(pullTarget) < 0.4 || h.pulled > 1.5) this._finishHook();
    } else if (h.phase === 'retract') {
      const pullTarget = this.player.pos.clone();
      pullTarget.y = this.ocean.surfaceY(pullTarget.x, pullTarget.z, t);
      h.pos.lerp(pullTarget, Math.min(1, dt * 6));
      this._hookMesh.position.copy(h.pos);
      if (h.pos.distanceTo(pullTarget) < 0.4) this._finishHook();
    }

    const lp = this.hookLine.geometry.attributes.position;
    lp.setXYZ(0, this.camera.position.x, this.camera.position.y - 0.3, this.camera.position.z);
    lp.setXYZ(1, h.pos.x, h.pos.y, h.pos.z);
    lp.needsUpdate = true;
  }

  _finishHook() {
    const h = this.hook;
    const n = h.items.length;
    for (const it of h.items) {
      if (this.resources.items.includes(it)) this.resources.collect(it); // 直接放入背包
    }
    h.items = [];
    h.active = false;
    h.phase = 'idle';
    this._hookMesh.visible = false;
    this.hookLine.visible = false;
    this.ui.refreshCounts();
    this._flash(n > 0 ? `🪝 收回钩锁，获得 ${n} 件物品` : '🪝 钩锁空手而归', 1.5);
    this.toolCooldown = 0.8;
  }

  // 🕸️ 渔网：网住 7m 内所有漂浮物
  _useNet() {
    const caught = this._collectWithin(7);
    if (caught === 0) { this._flash('🕸️ 网里空空如也', 1.5); return; }
    this.ui.refreshCounts();
    this._flash(`🕸️ 一网打尽，收获 ${caught} 件`, 2.0);
    this.toolCooldown = 4.0;
  }

  // 🔱 鱼叉：戳前方 6m 内单个漂浮物（预留敌人判定）
  _useSpear() {
    const item = this._nearestItemWithin(6, true);
    if (!item) { this._flash('🔱 前方没有目标', 1.5); return; }
    this.resources.collect(item);
    this.ui.refreshCounts();
    this._flash(`🔱 叉中了 ${ITEMS[item.type].name}`, 1.5);
    this.toolCooldown = 0.8;
  }

  _flash(msg, time) {
    this.toolMsg = msg;
    this.toolMsgTimer = time;
  }

  // 浮动原点：把所有实体整体平移，使玩家回到海面中心（原点），
  // 避免木筏无限漂移出界。玩家屏幕位置基本不变（场景被拉回）。
  _recenter() {
    const dx = this.player.pos.x, dz = this.player.pos.z;
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;

    // 木筏整体平移回中心
    this.raft.offset.x -= dx; this.raft.offset.z -= dz;
    this.raft.group.position.x = this.raft.offset.x;
    this.raft.group.position.z = this.raft.offset.z;

    // 所有漂浮物同步平移
    for (const it of this.resources.items) {
      it.mesh.position.x -= dx; it.mesh.position.z -= dz;
    }

    // 资源生成中心与速度追踪归零，避免回中瞬间速度突跳
    this.resources.center.set(0, 0, 0);
    this.resources.prevCenter.set(0, 0, 0);
    this.resources.playerVel.set(0, 0, 0);

    // 钓鱼浮漂与目标同步
    if (this.bobber.visible) { this.bobber.position.x -= dx; this.bobber.position.z -= dz; }
    if (this.fishing) { this.fishing.target.x -= dx; this.fishing.target.z -= dz; }
    if (this.hook && this.hook.active) {
      this.hook.pos.x -= dx; this.hook.pos.z -= dz;
      for (const it of this.hook.items) { it.mesh.position.x -= dx; it.mesh.position.z -= dz; }
    }

    // 玩家回到中心
    this.player.pos.x -= dx; this.player.pos.z -= dz;

  }

  // 右键：拾取「瞄准（视角前方）且近距离」的漂浮物
  _tryPickup() {
    const fwd = this._forward();
    let best = null, bestD = 3.0;
    for (const it of this.resources.items) {
      const to = it.mesh.position.clone().sub(this.player.pos);
      const d = to.length();
      if (d > 3.0) continue;
      to.normalize();
      if (to.dot(fwd) < 0.5) continue; // 必须在视角前方（已瞄准）
      if (d < bestD) { bestD = d; best = it; }
    }
    if (!best) { this._flash('未瞄准可拾取的漂浮物', 1.0); return; }
    this.resources.collect(best);
    this.ui.refreshCounts();
  }

  _tryBuild() {
    const [gx, gz] = this.raft.worldToGrid(this.player.pos.x, this.player.pos.z);
    // 找到玩家所在格相邻的空格用于扩建
    const cell = this.raft.nearestEmptyNeighbor(this.player.pos.x, this.player.pos.z);
    if (!cell) return;
    if (!this.inventory.consume('lumber', 2)) {
      this.ui.setPrompt('需要 2木材来扩建木筏');
      return;
    }
    this.raft.addTile(cell[0], cell[1]);
    this.ui.refreshCounts();
  }

  onCraft(recipe) {
    if (recipe.structural) {
      if (recipe.id === 'tile') {
        const cell = this.raft.nearestEmptyNeighbor(this.player.pos.x, this.player.pos.z);
        if (cell) this.raft.addTile(cell[0], cell[1]);
      } else if (recipe.id === 'wall') {
        this._placeWall();
      } else if (recipe.id === 'sail') {
        this.raft.addSail();
      }
    } else if (recipe.output) {
      // 产出类：把结果物品加入背包（含工具类道具）
      this.inventory.add(recipe.output.id, recipe.output.n);
    }
    this.ui.refreshCounts();
  }

  _placeWall() {
    const [gx, gz] = this.raft.worldToGrid(this.player.pos.x, this.player.pos.z);
    const [wx, wz] = this.raft.gridToLocal(gx, gz);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x6f4a22, roughness: 1 })
    );
    wall.position.set(wx, 0.8, wz);
    wall.castShadow = true;
    this.raft.group.add(wall);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // 接近海面边缘时，把所有实体以玩家为中心整体平移回原点（浮动原点）
    if (Math.hypot(this.player.pos.x, this.player.pos.z) > this.edgeRadius) this._recenter();

    this.ocean.update(t);
    this.raft.update(this.ocean, t, dt, this.player);
    // 合成表/背包打开时冻结玩家移动（但仍随木筏漂移），关闭后恢复
    const frozen = this.ui.openPanel !== null;
    this.player.update(dt, this.ocean, t, frozen);
    this.resources.update(dt, this.player.pos, t);

    if (this.toolCooldown > 0) this.toolCooldown -= dt;
    if (this.charging) {
      this.charging.t += dt; // 蓄力计时
      this.ui.setCharge(Math.min(1, this.charging.t / 1.0));
    } else {
      this.ui.setCharge(null);
    }
    this._updateFishing(dt);
    this._updateHook(dt, t);

    // 建造预览：若玩家所在格有相邻空格且买得起，显示幽灵格
    const cell = this.raft.nearestEmptyNeighbor(this.player.pos.x, this.player.pos.z);
    if (cell && this.inventory.has('lumber', 2)) {
      const [wx, wz] = this.raft.gridToWorld(cell[0], cell[1]);
      this.ghost.position.set(wx, 0, wz);
      this.ghost.visible = true;
    } else {
      this.ghost.visible = false;
    }

    // 提示优先级：钓鱼中 > 道具反馈 > 拾取/建造
    let prompt = '';
    if (this.fishing) {
      prompt = '🎣 等待鱼儿上钩…';
    } else if (this.toolMsgTimer > 0) {
      this.toolMsgTimer -= dt;
      prompt = this.toolMsg;
    } else {
      const near = this.resources.nearest(this.player.pos);
      if (near) prompt = `右键 拾取 ${this._label(near.type)}`;
      else if (this.ghost.visible) prompt = '左键 扩建木筏 (2 木材)';
    }
    this.ui.setPrompt(prompt);

    this.renderer.render(this.scene, this.camera);
  }

  _label(type) {
    return ITEMS[type]?.name || type;
  }
}

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
    this.toolOrder = ['hook', 'fishing_rod', 'net', 'spear'];
    this.toolCooldown = 0;
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
  }

  _bindInteractions() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') this._tryCollect();
      if (e.code === 'KeyF') this._useTool();
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        this._equip(this.toolOrder[+e.code.slice(-1) - 1]);
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (this.player.locked && e.button === 0) this._tryBuild();
    });
  }

  // —— 装备 / 使用 ——
  _equip(id) {
    if (!this.inventory.has(id)) {
      this.ui.setPrompt(`尚未拥有 ${ITEMS[id]?.name || id}`);
      return;
    }
    this.equipped = id;
    this.ui.setEquipped(id);
  }

  _useTool() {
    if (!this.equipped) { this.ui.setPrompt('未装备道具：按 1-4 装备'); return; }
    if (this.toolCooldown > 0) return;
    switch (this.equipped) {
      case 'fishing_rod': this._useFishingRod(); break;
      case 'hook':        this._useHook(); break;
      case 'net':         this._useNet(); break;
      case 'spear':       this._useSpear(); break;
    }
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

  // 🎣 鱼竿：抛竿 → 等待 → 钓上随机物品
  _useFishingRod() {
    if (this.fishing) return;
    const fwd = this._forward();
    const target = this.player.pos.clone().add(fwd.multiplyScalar(9));
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
      const lootPool = ['apple', 'banana', 'orange', 'plastic', 'rope', 'lumber'];
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

  // ⚓ 铁钩：把 18m 内最近的漂浮物钩到面前
  _useHook() {
    const item = this._nearestItemWithin(18, false);
    if (!item) { this._flash('⚓ 附近没有可钩的漂浮物', 1.5); return; }
    const fwd = this._forward();
    const p = this.player.pos.clone().add(fwd.multiplyScalar(2));
    item.mesh.position.set(p.x, 0.3, p.z);
    this._flash(`⚓ 钩回了 ${ITEMS[item.type].name}`, 1.5);
    this.toolCooldown = 1.0;
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

    // 玩家回到中心
    this.player.pos.x -= dx; this.player.pos.z -= dz;

  }

  _tryCollect() {
    const near = this.resources.nearest(this.player.pos);
    if (near) {
      this.resources.collect(near);
      this.ui.refreshCounts();
    }
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
    this._updateFishing(dt);

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
      if (near) prompt = `按 E 拾取 ${this._label(near.type)}`;
      else if (this.ghost.visible) prompt = '左键 扩建木筏 (2 木材)';
    }
    this.ui.setPrompt(prompt);

    this.renderer.render(this.scene, this.camera);
  }

  _label(type) {
    return ITEMS[type]?.name || type;
  }
}

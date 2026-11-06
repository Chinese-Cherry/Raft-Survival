import * as THREE from 'three';
import { Ocean } from './Ocean.js';
import { Raft } from './Raft.js';
import { Inventory, PACK_SIZE } from './Inventory.js';
import { Crafting } from './Crafting.js';
import { Player } from './Player.js';
import { Resources, TYPES } from './Resources.js';
import { UI } from './UI.js';
import { ITEMS } from './Items.js';
import { CFG, START_ITEMS, START_EQUIPPED } from './let.js';
import { buildPlayerModel } from '../models/player/player.js';

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
    // 玩家可见模型：第三人称显示完整人形；第一人称显示挂在相机下的手臂视角
    this.playerModel = buildPlayerModel();
    this.scene.add(this.playerModel.group);
    this.scene.add(this.camera);            // 让挂在相机下的第一人称手臂可被渲染
    this.camera.add(this.playerModel.fp);
    this.thirdPerson = false;
    this.ui = new UI(this.inventory, this.crafting, this);

    this._setupBuildGhost();
    this._setupTools();
    this._bindInteractions();
    // 开局默认物品与默认装备（配置见 let.js 的 START_ITEMS / START_EQUIPPED）
    // START_ITEMS() 返回 Map，需直接迭代（Object.entries 对 Map 只会得到空数组）
    for (const [id, n] of START_ITEMS()) {
      if (n > 0) this.inventory.add(id, n);
    }
    if (START_EQUIPPED && this.inventory.has(START_EQUIPPED)) this._equip(START_EQUIPPED);
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
    // 绑定在木筏上：作为 raft.group 的子节点，随木筏一起漂移、随浪起伏
    this.raft.group.add(this.ghost);

    // 船帆幽灵模型（建造预览：桅杆 + 帆）
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x66ff99, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    });
    this.sailGhostMat = ghostMat;
    this.sailGhost = new THREE.Group();
    const gmast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), ghostMat);
    gmast.position.y = 1.5;
    const gsail = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), ghostMat);
    gsail.position.y = 2.0;
    this.sailGhost.add(gmast, gsail);
    this.sailGhost.visible = false;
    this.raft.group.add(this.sailGhost);

    // 木墙幽灵：贴在目标格东/西/南/北边缘，细轴朝向偏移方向
    this.wallGhost = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.6, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.4 })
    );
    this.wallGhost.visible = false;
    this.raft.group.add(this.wallGhost);

    // 渔网幽灵：与实体一致（带圆孔的木板 + 中空网圈），占一个空格子
    this.netGhostMat = new THREE.MeshBasicMaterial({
      color: 0x66ff99, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    });
    this.netGhost = new THREE.Group();
    const nbase = new THREE.Mesh(this._netPlateGeometry(this.raft.tileSize), this.netGhostMat);
    const nnet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.25, 24, 1, true),
      this.netGhostMat
    );
    nnet.position.y = 0.05;
    this.netGhost.add(nbase, nnet);
    this.netGhost.visible = false;
    this.raft.group.add(this.netGhost);

    this.buildMode = null;   // 建造模式：'tile'（木筏格子）/ 'wall'（木墙）/ 'net'（渔网）/ 'sail'（船帆）
    this.buildTarget = null; // 当前建造目标 { type, ok, reason, ... }
    this.buildings = []; // 已建建筑：[{ type, x, z }]（x/z 为木筏局部坐标）
    // 木墙/渔网的网格、可踩甲板与碰撞统一由 Raft 维护
    // （见 Raft.addWall / Raft.resolveWalls / Raft.addNetCell）
  }

  _recipe(id) {
    return this.crafting.recipes.find((r) => r.id === id);
  }

  _costText(recipe) {
    return Object.entries(recipe.cost)
      .map(([id, n]) => `${ITEMS[id]?.name || id}x${n}`)
      .join(' ');
  }

  // 在合成菜单中选中建筑配方后进入建造模式（幽灵格随之出现），左键放置、右键/Esc 取消。
  // 选择时即给出提示：能否建造 / 如何操作。返回是否成功进入建造模式。
  selectBuild(id) {
    const r = this._recipe(id);
    if (!r) return false;
    if (id === 'sail' && this.raft.hasSail) {
      this._flash('已建造船帆，无法重复建造', 2.0);
      return false;
    }
    this.buildMode = id;
    this.buildTarget = null; // 切换建造模式时清空上一模式的目标
    const ok = this.crafting.canCraft(r);
    this._flash(ok
      ? `可以建造：${r.name}（${this._costText(r)}）左键放置，右键/Esc 取消`
      : '无法建造（材料不足）', 3.0);
    return true;
  }

  cancelBuild() {
    this.buildMode = null;
    this.buildTarget = null;
    this.ghost.visible = false;
    this.sailGhost.visible = false;
    this.wallGhost.visible = false;
    this.netGhost.visible = false;
  }

  _setupTools() {
    this.equipped = null;
    this.toolCooldown = 0;
    this.hook = null;      // 钩锁投射物状态（flying / pulling / retract）
    this.charging = null;  // 蓄力状态 { type, t }
    this.toolMsg = '';
    this.toolMsgTimer = 0;
    this.fishing = null;
    this.aimingSail = false; // 是否处于“转动视角设定船帆航向”模式

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

    // 木筏建筑：已放置的渔网列表（每个渔网自带储物格）
    this.placedNets = [];
  }

  _bindInteractions() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') this.thirdPerson = !this.thirdPerson; // 切换第一/三人称
      // E：调整航向时确认；否则瞄准船帆/渔网时打开对应面板
      if (e.code === 'KeyE') {
        if (this.aimingSail) {
          this.confirmSailAim();
        } else if (!this.ui.openPanel) {
          if (this._aimAtSail()) this.ui.toggleSailPanel();
          else {
            const net = this._aimAtNet();
            if (net) this.ui.toggleNetPanel(net);
          }
        }
      }
      if (e.code === 'Escape') {
        // Esc：取消定航向 → 关面板 → 退出建造模式 → 离木筏太远时询问是否传送回去
        if (this.aimingSail) this.cancelSailAim();
        else if (this.ui.openPanel) this.ui.closePanels();
        else if (this.buildMode) this.cancelBuild();
        else this._tryRescuePrompt();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (this.ui.openPanel) return;
      if (e.button === 0) this._onLeftDown();  // 左键：使用道具（鱼竿/钩锁蓄力） / 建造
      if (e.button === 2) {
        if (this.aimingSail) { this.cancelSailAim(); return; } // 调整航向中：右键取消
        if (this.buildMode) { this.cancelBuild(); return; }    // 建造模式：右键取消
        this._tryPickup();                                    // 右键：瞄准拾取
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._onLeftUp();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // —— 装备 / 使用 ——
  _equip(id) {
    // 建造依赖于幽灵格：切换掉建造锤即退出建造模式
    if (id !== 'build_hammer') this.cancelBuild();
    if (id === null) { this.equipped = null; this.ui.setEquipped(null); return; }
    if (!this.inventory.has(id)) {
      this.ui.setPrompt(`尚未拥有 ${ITEMS[id]?.name || id}`);
      return;
    }
    this.equipped = id;
    this.ui.setEquipped(id);
  }

  // 鱼竿/钩锁走蓄力抛出流程（左键按下蓄力、松开抛出）；建造锤由 _onLeftDown 单独处理。
  _useTool() {
    if (!this.equipped) { this.ui.setPrompt('未装备道具：按数字键选中快捷栏道具'); return; }
    if (this.toolCooldown > 0) return;
    // 渔网已改为木筏建筑，不再作为即时道具使用；此处保留以兼容其它瞬时道具。
    switch (this.equipped) {
    }
  }

  // 左键按下：建造模式（幽灵格已出现）——建造；鱼竿/钩锁——蓄力抛出；其它道具——立即使用
  _onLeftDown() {
    if (!this.player.locked) return;
    if (this.aimingSail) { this.confirmSailAim(); return; } // 调整航向：左键确认
    if (this.buildMode === 'tile') { this._tryBuildTile(); return; }
    if (this.buildMode === 'wall') { this._tryBuildWall(); return; }
    if (this.buildMode === 'net') { this._tryBuildNet(); return; }
    if (this.buildMode === 'sail') { this._tryBuildSail(); return; }
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

  // 🎣 鱼竿：左键蓄力后抛出，蓄力越久抛得越远；等待后钓上随机的鱼
  _useFishingRod(charge = 0) {
    if (this.fishing) return;
    this.playerModel?.playUse();
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
    this.playerModel?.playUse();
    const dir = this.camera.getWorldDirection(new THREE.Vector3()).normalize(); // 含玩家垂直朝向
    const speed = (16 + charge * 18) * CFG.hookForce; // 蓄力越久抛得越远；hookForce 等比缩放总力度
    const hand = this.playerModel.getHandWorld('right', new THREE.Vector3(), !this.thirdPerson);
    this.hook = {
      active: true,
      phase: 'flying',                       // flying → pulling → (retract)
      dir: dir.clone(),
      vel: dir.clone().multiplyScalar(speed),// 初速度（抛物线）
      pos: hand.add(dir.clone().multiplyScalar(0.3)), // 从右手抛出
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
      const pullTarget = this.playerModel.getHandWorld('right', new THREE.Vector3(), !this.thirdPerson);
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
      const pullTarget = this.playerModel.getHandWorld('right', new THREE.Vector3(), !this.thirdPerson);
      h.pos.lerp(pullTarget, Math.min(1, dt * 6));
      this._hookMesh.position.copy(h.pos);
      if (h.pos.distanceTo(pullTarget) < 0.4) this._finishHook();
    }

    const lp = this.hookLine.geometry.attributes.position;
    const handLine = this.playerModel.getHandWorld('right', new THREE.Vector3(), !this.thirdPerson);
    lp.setXYZ(0, handLine.x, handLine.y, handLine.z);
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

  // 准星是否瞄准船帆（近距离）——用于打开船帆互动面板
  _aimAtSail() {
    if (!this.raft.hasSail) return false;
    this.camera.updateMatrixWorld();
    this.raft.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = ray.intersectObject(this.raft.sailMesh, true)[0];
    return !!hit && hit.distance <= 4.5;
  }

  // 船帆互动：展开/收起
  toggleSail() {
    if (!this.raft.hasSail) return;
    this.raft.setSailOpen(!this.raft.sailOpen);
    this._flash(this.raft.sailOpen
      ? '船帆已展开：航速将缓慢提升到峰值'
      : '船帆已收起：航速逐渐回落到洋流漂移', 1.5);
  }

  // 船帆互动：进入“瞄准定航向”模式——转动视角预览，玩家确认后把船帆固定到该朝向
  beginSailAim() {
    if (!this.raft.hasSail) return;
    this.ui.closePanels(); // 关闭面板并重新锁定鼠标，便于转动视角
    this.aimingSail = true;
    this.raft.sailPreviewYaw = this.player.yaw;
  }

  // 确认：把船帆固定为当前玩家朝向
  confirmSailAim() {
    if (!this.aimingSail) return;
    this.raft.setSailYaw(this.player.yaw);
    this.raft.sailPreviewYaw = null;
    this.aimingSail = false;
    this._flash(`船帆航向已固定为 ${this._headingText(this.player.yaw)}，木筏将缓慢转向`, 2.5);
  }

  cancelSailAim() {
    if (!this.aimingSail) return;
    this.raft.sailPreviewYaw = null;
    this.aimingSail = false;
    this._flash('已取消调整船帆航向', 1.5);
  }

  // —— 保底机制：离木筏超过 CFG.rescueRange 时，按 Esc 可选择传送回木筏 ——
  raftDistance() {
    return this.raft.distanceTo(this.player.pos.x, this.player.pos.z);
  }

  isFarFromRaft() {
    return this.raftDistance() > CFG.rescueRange;
  }

  // Esc（无面板/无建造/未在定航向时）：距离过远才弹出传送确认
  _tryRescuePrompt() {
    if (!this.isFarFromRaft()) return;
    this.ui.openRescuePanel();
  }

  // 传送回木筏中心格，清空速度与腾空状态，并立即贴合相机
  teleportToRaft() {
    const [gx, gz] = this.raft.centerTile();
    const [wx, wz] = this.raft.gridToWorld(gx, gz);
    this.player.pos.set(wx, this.raft.group.position.y + this.player.eye, wz);
    this.player.vel.set(0, 0, 0);
    this.player.airborne = false;
    this.player.grounded = true;
    this.camera.position.copy(this.player.pos); // 立即贴合，避免一帧拉丝
    this.ui.closePanels();
    this._flash('已传送回木筏', 1.5);
  }

  // yaw → 八方位文字（0°=北，顺时针），用于船帆航向提示
  _headingText(yaw) {
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return `${names[Math.round(deg / 45) % 8]}（${Math.round(deg)}°）`;
  }

  // 右键：瞄准船帆/渔网时打开对应面板；否则拾取「瞄准（视角前方）且近距离」的漂浮物
  _tryPickup() {
    if (this._aimAtSail()) { this.ui.toggleSailPanel(); return; }
    const net = this._aimAtNet();
    if (net) { this.ui.toggleNetPanel(net); return; }
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

  // —— 建造定位：所有木筏建筑共用同一套网格判定 ——
  // 准星命中点（世界坐标）及其所在格；未命中木筏时退化为玩家所在位置
  _aimInfo() {
    const p = this._pickRaftPoint();
    const x = p ? p.x : this.player.pos.x;
    const z = p ? p.z : this.player.pos.z;
    const [gx, gz] = this.raft.worldToGrid(x, z);
    return { gx, gz, x, z, hit: !!p };
  }

  // 偏移方向：准星命中点相对该格中心的四正方向（东/西/南/北），与玩家朝向无关
  _offsetDir(gx, gz, x, z) {
    const [cx, cz] = this.raft.gridToWorld(gx, gz);
    const dx = x - cx, dz = z - cz;
    if (Math.abs(dx) < 1e-3 && Math.abs(dz) < 1e-3) {
      // 正对格心（偏移量为 0，无法判定）：按视线水平主轴兜底
      const f = this._forward();
      return Math.abs(f.x) >= Math.abs(f.z)
        ? { dx: Math.sign(f.x) || 1, dz: 0 }
        : { dx: 0, dz: Math.sign(f.z) || 1 };
    }
    return Math.abs(dx) >= Math.abs(dz)
      ? { dx: Math.sign(dx), dz: 0 }
      : { dx: 0, dz: Math.sign(dz) };
  }

  // 当前建造目标：准星格 (gx,gz) + 格内偏移方向 (dx,dz) → 相邻格 (cx,cz)
  _targetCell() {
    const a = this._aimInfo();
    const d = this._offsetDir(a.gx, a.gz, a.x, a.z);
    return {
      gx: a.gx, gz: a.gz, dx: d.dx, dz: d.dz,
      cx: a.gx + d.dx, cz: a.gz + d.dz, hit: a.hit,
    };
  }

  _dirText(dx, dz) {
    if (dx > 0) return '东';
    if (dx < 0) return '西';
    return dz > 0 ? '南' : '北';
  }

  // 取当前模式对应的建造目标（极快点击时先用当前准星刷新一次）
  _targetFor(mode) {
    if (!this.buildTarget || this.buildTarget.type !== mode) this._updateBuildPreview();
    return this.buildTarget;
  }

  // 按配方扣料
  _consumeRecipe(id) {
    const r = this._recipe(id);
    Object.entries(r.cost).forEach(([k, n]) => this.inventory.consume(k, n));
    return r;
  }

  _tryBuildTile() {
    const b = this._targetFor('tile');
    if (!b || b.cx === undefined) { this._flash('无法建造（请瞄准木筏格子）', 1.2); return; }
    if (!b.ok) { this._flash(`无法建造（${b.reason}）`, 1.2); return; }
    this._consumeRecipe('tile');
    this.raft.addTile(b.cx, b.cz);
    // 建造模式保留，可连续扩建；右键/Esc 退出
    this._flash(this.buildMode === 'tile' ? '扩建完成（右键/Esc 退出建造）' : '扩建完成', 1.0);
    this.ui.refreshCounts();
  }

  // 准星射线命中木筏面的精确世界坐标（不做格子吸附）；未命中返回 null
  _pickRaftPoint() {
    // 相机与木筏本帧位置都已变化，先刷新世界矩阵，避免射线用上一帧的变换
    this.camera.updateMatrixWorld();
    this.raft.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    // 木筏格子 + 渔网都可作为建造基准（渔网是 Group，需递归检测其子网格）
    const hit = ray.intersectObjects(this.raft.aimTargets(), true)[0];
    if (!hit) return null;
    return { x: hit.point.x, z: hit.point.z };
  }

  // 船帆占地（1.6 宽）的四个角是否都在木筏格内：超出一点也算超出
  _sailFitsOnRaft(x, z) {
    const h = 0.8;
    return [[-1, -1], [1, -1], [-1, 1], [1, 1]]
      .every(([sx, sz]) => this.raft.containsPoint(x + sx * h, z + sz * h));
  }

  // 是否与已建建筑（木墙/渔网）重叠（按占地半径近似）
  _overlapsBuilding(lx, lz) {
    for (const b of this.buildings) {
      if (Math.hypot(lx - b.x, lz - b.z) < 1.7) return true;
    }
    return false;
  }

  // 建造预览：按建造模式刷新对应的幽灵体，并记录目标是否可建造
  _updateBuildPreview() {
    const mode = this.buildMode;
    if (mode !== 'tile') this.ghost.visible = false;
    if (mode !== 'wall') this.wallGhost.visible = false;
    if (mode !== 'net') this.netGhost.visible = false;
    if (mode !== 'sail') this.sailGhost.visible = false;
    this.buildTarget = null;
    if (!mode) return;

    // 网格类建筑（木筏格子 / 木墙 / 渔网）：准星格 + 偏移方向
    if (mode === 'tile' || mode === 'wall' || mode === 'net') {
      const t = this._targetCell();
      // 偏移方向取决于准星落在格子上的位置，因此必须瞄准木筏格子
      if (!t.hit) {
        this.ghost.visible = false;
        this.wallGhost.visible = false;
        this.netGhost.visible = false;
        this.buildTarget = { type: mode, ...t, ok: false, reason: '请瞄准木筏格子' };
        return;
      }
      let reason = '';
      if (mode === 'tile') {
        if (this.raft.hasTile(t.cx, t.cz)) reason = '该位置已有木筏';
        else if (this.raft.hasNetCell(t.cx, t.cz)) reason = '该位置已有渔网';
      } else if (mode === 'wall') {
        if (this.raft.hasWall(t.gx, t.gz, t.dx, t.dz)) reason = '该位置已有木墙';
      } else {
        // 渔网与木筏格子共用网格：只能放在空格子上（不与木筏格子重叠），且一格一张
        if (this.raft.hasTile(t.cx, t.cz)) reason = '该位置已有木筏';
        else if (this.raft.hasNetCell(t.cx, t.cz)) reason = '该位置已有渔网';
      }
      if (!reason && !this.crafting.canCraft(this._recipe(mode))) reason = '材料不足';
      const ok = !reason;
      if (mode === 'tile') {
        const [lx, lz] = this.raft.gridToLocal(t.cx, t.cz);
        this.ghost.position.set(lx, -0.15, lz);
        this.ghost.material.color.set(ok ? 0x00ff88 : 0xff4444);
        this.ghost.visible = true;
      } else if (mode === 'wall') {
        const p = this.raft.wallPose(t.gx, t.gz, t.dx, t.dz);
        this.wallGhost.position.set(p.x, 0.8, p.z);
        this.wallGhost.rotation.y = p.rotY;
        this.wallGhost.material.color.set(ok ? 0x00ff88 : 0xff4444);
        this.wallGhost.visible = true;
      } else {
        const [lx, lz] = this.raft.gridToLocal(t.cx, t.cz);
        this.netGhost.position.set(lx, 0, lz);
        this.netGhostMat.color.set(ok ? 0x00ff88 : 0xff4444);
        this.netGhost.visible = true;
      }
      this.buildTarget = { type: mode, ...t, ok, reason };
      return;
    }

    // 船帆：放在准星命中的任意位置（不吸附格子中心）
    const point = this._pickRaftPoint();
    if (!point) {
      this.sailGhost.visible = false;
      this.buildTarget = { type: 'sail', point: null, ok: false, reason: '超出木筏' };
      return;
    }
    const lx = point.x - this.raft.offset.x; // 转成木筏局部坐标（随筏漂移）
    const lz = point.z - this.raft.offset.z;
    const hasMats = this.crafting.canCraft(this._recipe('sail'));
    let reason = '';
    if (!this._sailFitsOnRaft(point.x, point.z)) reason = '超出木筏';
    else if (this._overlapsBuilding(lx, lz)) reason = '与该建筑重叠';
    else if (!hasMats) reason = '材料不足';
    else if (this.raft.hasSail) reason = '已建造船帆';
    const ok = !reason;
    this.sailGhost.position.set(lx, 0, lz);
    this.sailGhostMat.color.set(ok ? 0x00ff88 : 0xff4444);
    this.sailGhost.visible = true;
    this.buildTarget = { type: 'sail', point: { x: lx, z: lz }, ok, reason };
  }

  // 木墙：贴在该格朝偏移方向（东/西/南/北）的边缘，墙面朝向偏移方向
  _tryBuildWall() {
    const b = this._targetFor('wall');
    if (!b || b.gx === undefined) { this._flash('无法建造（请瞄准木筏格子）', 1.2); return; }
    if (!b.ok) { this._flash(`无法建造（${b.reason}）`, 1.2); return; }
    if (this.raft.hasWall(b.gx, b.gz, b.dx, b.dz)) { this._flash('无法建造（该位置已有木墙）', 1.2); return; }
    this._consumeRecipe('wall');
    this._createWall(b.gx, b.gz, b.dx, b.dz);
    this._flash(`木墙建造完成（格子${this._dirText(b.dx, b.dz)}侧，可阻挡通行）`, 1.5);
    this.ui.refreshCounts();
  }

  // 渔网：与木筏格子同一套网格，只能建在空格子上（不与木筏格子重叠）
  _tryBuildNet() {
    const b = this._targetFor('net');
    if (!b || b.cx === undefined) { this._flash('无法建造（请瞄准木筏格子）', 1.2); return; }
    if (!b.ok) { this._flash(`无法建造（${b.reason}）`, 1.2); return; }
    this._consumeRecipe('net');
    this._createNet(b.cx, b.cz);
    this._flash('渔网建造完成：碰到漂浮物会直接收进储物格，右键渔网可取货', 2.2);
    this.ui.refreshCounts();
  }

  _tryBuildSail() {
    const b = this._targetFor('sail');
    if (!b || !b.point) { this._flash('无法建造（超出木筏）', 1.2); return; }
    if (!b.ok) { this._flash(`无法建造（${b.reason}）`, 1.2); return; }
    this._consumeRecipe('sail');
    if (!this.raft.addSail(b.point.x, b.point.z)) {
      this._flash('已建造船帆，无法重复建造', 1.5);
      return;
    }
    this.buildings.push({ type: 'sail', x: b.point.x, z: b.point.z });
    this.cancelBuild(); // 船帆只能建一个，放置后退出建造模式
    this._flash('船帆建造完成：右键船帆可展开/收起并调整航向', 2.5);
    this.ui.refreshCounts();
  }

  onCraft(recipe) {
    if (recipe.structural) {
      // 木筏建筑（木筏格子/木墙/渔网/船帆）统一走建造模式（place=true），不会直接到这里；
      // 兜底：若被直接调用，只做材料提示，避免绕过网格判定乱放。
      this.ui.setPrompt('请手持建造锤，在建造菜单中选择该建筑');
    } else if (recipe.output) {
      // 产出类：把结果物品加入背包（含工具类道具）
      this.inventory.add(recipe.output.id, recipe.output.n);
    }
    this.ui.refreshCounts();
  }

  // 生成木墙：贴在目标格朝 (dx,dz) 方向的边上，薄边与偏移方向对齐。
  // 网格/模型/碰撞体都由 Raft 维护（Raft.addWall），玩家撞墙由 Raft.resolveWalls 推出。
  _createWall(gx, gz, dx, dz) {
    const wall = this.raft.addWall(gx, gz, dx, dz);
    if (!wall) return null;
    this.buildings.push({ type: 'wall', x: wall.lx, z: wall.lz }); // 记录位置，避免船帆重叠
    return wall;
  }

  // 渔网外框木板：与木筏格同尺寸，但中间挖掉一圈与网圈同直径的圆孔（圆圈内部空心）
  _netPlateGeometry(size) {
    const half = (size * 0.99) / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-half, -half);
    shape.lineTo(half, -half);
    shape.lineTo(half, half);
    shape.lineTo(-half, half);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.92, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 28 });
    geo.rotateX(-Math.PI / 2); // 平放：挤出方向 +Z → +Y
    geo.translate(0, -0.3, 0); // 顶面拉到 y=0，与木筏格高度一致
    return geo;
  }

  // 生成渔网：占一个空格子（与木筏格子同一网格），挂在 raft.group 下随木筏漂移。
  // 外形 = 与木筏格子一致但在中间开了圆孔的外框木板 + 内部中空的网圈（圆圈内部空心）。
  // 每个渔网自带一个储物格 storage（与背包同样的 16 格 + 同样堆叠上限）。
  _createNet(gx, gz) {
    const [lx, lz] = this.raft.gridToLocal(gx, gz);

    const group = new THREE.Group();
    group.position.set(lx, 0, lz);

    // 外部：带圆孔的木板（尺寸/高度/颜色与木筏格一致）
    const base = new THREE.Mesh(
      this._netPlateGeometry(this.raft.tileSize),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 })
    );
    base.receiveShadow = true;
    base.castShadow = true;

    // 内部：中空的网圈（开口圆柱，无上下盖，中间透空可看到水面）
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.25, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xeeeeee, roughness: 1, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      })
    );
    mesh.position.y = 0.05;
    mesh.castShadow = true;

    // 圈口加一圈白色绳边，强化"网圈"外观
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.05, 6, 28),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 1 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.18;
    rim.castShadow = true;

    // 空心处的"展示位"：有物品时在这里摆出对应的模型（每种物品只摆一个）
    const showcase = new THREE.Group();
    showcase.position.y = 0.02;

    group.add(base, mesh, rim, showcase);
    this.raft.group.add(group);
    this.raft.addNetCell(gx, gz, group); // 注册为可踩/可瞄准的甲板格

    const net = {
      gx, gz,
      group, mesh, showcase,
      storage: new Array(PACK_SIZE).fill(null), // 储物格：{ id, n } 或 null（与背包一致的格子与堆叠）
      timer: 0,                                 // 自动产出计时
    };
    this.placedNets.push(net);
    this.buildings.push({ type: 'net', x: lx, z: lz }); // 记录位置，避免船帆重叠
    return net;
  }

  // 渔网逻辑：
  //  1) 碰到漂浮物即吸入，立刻变成对应物品存进该网自己的储物格（储物格满则留在水面上）；
  //  2) 每隔 CFG.netAutoItemInterval 秒自动产出一件随机的「漂浮物对应物品」存进储物格。
  _updateNets(dt) {
    if (this.placedNets.length === 0) return;
    const R = CFG.netContactRadius ?? 1.2;
    const R2 = R * R;
    const step = Math.max(0.2, CFG.netAutoItemInterval ?? 3);
    const pool = Object.keys(TYPES); // 可漂浮的资源种类（塑料/木材/水果/树叶…）
    let changed = false;
    for (const net of this.placedNets) {
      // —— 1) 接触吸入 —— 网心世界坐标直接由格子换算
      const [wx, wz] = this.raft.gridToWorld(net.gx, net.gz);
      for (const it of this.resources.items.slice()) {
        if (it.pulling) continue; // 钩锁正在拉回的不抢
        const ix = it.mesh.position.x, iz = it.mesh.position.z;
        const [igx, igz] = this.raft.worldToGrid(ix, iz);
        const inCell = igx === net.gx && igz === net.gz;
        const dx = ix - wx, dz = iz - wz;
        if (!inCell && dx * dx + dz * dz > R2) continue;
        // 储物格放不下：本次不吸入，漂浮物继续留在水面上
        if (this._storeNetItem(net, it.type, 1) > 0) continue;
        this.resources.absorb(it);
        changed = true;
      }

      // —— 2) 定时自动产出：每过一段时间随机生成一件漂浮物对应的物品 ——
      net.timer += dt;
      while (net.timer >= step) {
        const id = pool[(Math.random() * pool.length) | 0];
        if (this._storeNetItem(net, id, 1) > 0) { net.timer = step; break; } // 储物格满：等腾出空间再继续
        net.timer -= step;
        changed = true;
      }

      // 3) 空心处的展示模型跟随储物内容变化
      if (this._syncNetShowcase(net)) changed = true;
    }
    if (changed && this.ui.openPanel === 'net') this.ui.renderNet();
  }

  // 储物内容（物品种类）变化时才重建展示模型，返回是否发生了重建
  _syncNetShowcase(net) {
    if (!net.showcase) return false;
    const ids = new Set();
    for (const s of net.storage) if (s) ids.add(s.id);
    const sig = [...ids].sort().join(',');
    if (sig === net._showcaseSig) return false;
    net._showcaseSig = sig;
    this._refreshNetShowcase(net);
    return true;
  }

  // 渔网红心展示：储物格里每种物品只摆一个模型（不同物品全部显示）。
  // 增量更新——已存在的模型保持原来的位置与朝向不变，只增删有变化的种类；
  // 新出现的模型在空心圆内随机位置、三轴随机朝向，静止不旋转、无碰撞。
  _refreshNetShowcase(net) {
    const box = net.showcase;
    if (!box) return;
    if (!net.showcaseItems) net.showcaseItems = new Map(); // id -> mesh
    const shown = net.showcaseItems;

    const ids = new Set();
    for (const s of net.storage) if (s) ids.add(s.id);

    // 1) 储物里已没有的种类：移除模型
    for (const [id, m] of shown) {
      if (ids.has(id)) continue;
      box.remove(m);
      shown.delete(id);
    }

    // 2) 新出现的种类：新建模型（已有的不动）
    const placed = [...shown.values()].map((m) => m.position);
    for (const id of ids) {
      if (shown.has(id)) continue;
      const def = TYPES[id];
      const tpl = def && def.model ? this.resources.foodTemplates[def.model] : null;
      let m;
      if (tpl) {
        m = tpl.clone(true); // 复用漂浮物的模型模板
      } else {
        // 没有模型模板时退化成一个同色小方块，至少能看出网里有东西
        m = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.3, 0.5),
          new THREE.MeshStandardMaterial({ color: def ? def.color : 0xcccccc })
        );
      }
      const sc = (CFG.floatScale?.[id] ?? 1) * 0.85;
      m.scale.setScalar(sc);

      // 在空心圆内随机找一个不和已有模型挤在一起的位置
      let px = 0, pz = 0;
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 0.45;
        px = Math.cos(ang) * rad;
        pz = Math.sin(ang) * rad;
        if (placed.every((p) => Math.hypot(p.x - px, p.z - pz) > 0.32)) break;
      }
      m.position.set(px, 0.02, pz);
      // 三个轴都随机朝向
      m.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
      m.castShadow = true;
      m.receiveShadow = true;
      box.add(m);
      shown.set(id, m);
      placed.push(m.position);
    }
  }

  // 把物品放进渔网储物格（堆叠上限与玩家背包一致），返回放不下的数量
  _storeNetItem(net, id, n = 1) {
    const max = this.inventory.maxStack(id);
    let remain = n;
    for (const s of net.storage) {
      if (s && s.id === id && s.n < max) {
        const put = Math.min(max - s.n, remain);
        s.n += put; remain -= put;
        if (remain <= 0) return 0;
      }
    }
    for (let i = 0; i < net.storage.length; i++) {
      if (!net.storage[i]) {
        const put = Math.min(max, remain);
        net.storage[i] = { id, n: put }; remain -= put;
        if (remain <= 0) return 0;
      }
    }
    return remain; // 储物格已满
  }

  // 从渔网某一格取出物品放入背包（背包放不下的部分留在网里）
  takeNetItem(net, idx) {
    const s = net.storage[idx];
    if (!s) return;
    const named = ITEMS[s.id]?.name || s.id;
    const left = this.inventory.add(s.id, s.n);
    const taken = s.n - left;
    if (taken <= 0) { this._flash(`背包已满，无法取出${named}`, 1.2); return; }
    if (left > 0) s.n = left; else net.storage[idx] = null;
    this._flash(`取出 ${named} x${taken}`, 1.2);
    this.ui.refreshCounts();
    if (this.ui.openPanel === 'net') this.ui.renderNet();
  }

  // 一键取出渔网内全部物品
  takeAllNetItems(net) {
    let moved = 0;
    for (let i = 0; i < net.storage.length; i++) {
      const s = net.storage[i];
      if (!s) continue;
      const left = this.inventory.add(s.id, s.n);
      moved += s.n - left;
      if (left > 0) s.n = left; else net.storage[i] = null;
    }
    this._flash(moved > 0 ? `取出 ${moved} 件物品` : '背包已满或渔网为空', 1.2);
    this.ui.refreshCounts();
    if (this.ui.openPanel === 'net') this.ui.renderNet();
  }

  // 准星是否瞄准渔网（近距离）——用于右键打开渔网储物面板
  _aimAtNet() {
    if (this.placedNets.length === 0) return null;
    this.camera.updateMatrixWorld();
    this.raft.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    // 渔网现在是 Group（外框木板 + 网本体），需要递归检测其子网格
    const hit = ray.intersectObjects(this.placedNets.map((n) => n.group), true)[0];
    if (!hit || hit.distance > 4.5) return null;
    const owner = (o) => { while (o) { const n = this.placedNets.find((p) => p.group === o); if (n) return n; o = o.parent; } return null; };
    return owner(hit.object);
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
    // 调整航向中：船帆随玩家视角实时转向预览（确认后才固定）
    if (this.aimingSail) this.raft.sailPreviewYaw = this.player.yaw;
    this.raft.update(this.ocean, t, dt, this.player);
    // 合成表/背包打开时冻结玩家移动（但仍随木筏漂移），关闭后恢复
    const frozen = this.ui.openPanel !== null;
    this.player.update(dt, this.ocean, t, frozen);
    this.resources.update(dt, this.player.pos, t);

    // 玩家可见模型：跟随玩家（脚底对齐），朝向 = yaw
    const p = this.player;
    const moving = !frozen && (p.keys['KeyW'] || p.keys['KeyA'] || p.keys['KeyS'] || p.keys['KeyD']);
    this.playerModel.group.position.set(p.pos.x, p.pos.y - p.eye, p.pos.z);
    this.playerModel.group.rotation.y = p.yaw;
    this.playerModel.group.visible = this.thirdPerson;  // 第三人称：完整人形
    this.playerModel.fp.visible = !this.thirdPerson;     // 第一人称：屏幕双手
    this.playerModel.update(dt, { moving });
    this.playerModel.fpUpdate();
    // 第三人称：相机退到玩家身后俯视
    if (this.thirdPerson) {
      const y = p.yaw;
      const back = new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
      const dist = 5;
      this.camera.position.set(p.pos.x + back.x * dist, p.pos.y + 0.8, p.pos.z + back.z * dist);
      this.camera.lookAt(p.pos.x, p.pos.y - 0.3, p.pos.z);
    }

    if (this.toolCooldown > 0) this.toolCooldown -= dt;
    if (this.charging) {
      this.charging.t += dt; // 蓄力计时
      this.ui.setCharge(Math.min(1, this.charging.t / 1.0));
    } else {
      this.ui.setCharge(null);
    }
    this._updateFishing(dt);
    this._updateHook(dt, t);
    this._updateNets(dt);

    // 建造预览：幽灵格/船帆幽灵随建造模式刷新（均绑定于木筏，随筏漂移）
    this._updateBuildPreview();

    // 提示优先级：钓鱼中 > 道具反馈 > 拾取/建造
    let prompt = '';
    if (this.fishing) {
      prompt = '🎣 等待鱼儿上钩…';
    } else if (this.aimingSail) {
      prompt = `转动视角确定船帆航向：${this._headingText(this.player.yaw)}　左键/E 确认，右键/Esc 取消`;
    } else if (this.toolMsgTimer > 0) {
      this.toolMsgTimer -= dt;
      prompt = this.toolMsg;
    } else {
      const near = this.resources.nearest(this.player.pos);
      const aimSail = !this.buildMode && this._aimAtSail();
      const aimNet = (!this.buildMode && !aimSail) ? this._aimAtNet() : null;
      if (aimSail) {
        prompt = '右键/E 操作船帆（开/收帆、调整航向）';
      } else if (aimNet) {
        const n = aimNet.storage.reduce((a, s) => a + (s ? s.n : 0), 0);
        prompt = `右键/E 打开渔网（储物 ${n} 件）`;
      } else if (near) {
        prompt = `右键 拾取 ${this._label(near.type)}`;
      } else if (this.buildMode && this.buildTarget) {
        const b = this.buildTarget;
        if (!b.ok) {
          prompt = `无法建造（${b.reason}）　右键/Esc 取消`;
        } else {
          const r = this._recipe(this.buildMode);
          prompt = `左键 放置${r.name}（${this._costText(r)}）　右键/Esc 取消`;
        }
      } else if (this.isFarFromRaft()) {
        prompt = '⚠ 已远离木筏：按 Esc 可选择传送回木筏';
      }
    }
    this.ui.setPrompt(prompt);

    this.renderer.render(this.scene, this.camera);
  }

  _label(type) {
    return ITEMS[type]?.name || type;
  }
}

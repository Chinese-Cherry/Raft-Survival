import * as THREE from 'three';

// 第一人称角色控制器：指针锁定 + WASD + 鼠标视角，
// 站在木筏上时正常行走，落水则减速（游泳）。
// 跳跃：空格起跳；水中无法起跳；腾空期间仍随木筏一起平移（与木筏保持相对运动），
// 叠加 WASD 输入即可相对木筏移动（如朝木筏边缘跳出则离开木筏）。
export class Player {
  constructor(camera, domElement, raft) {
    this.camera = camera;
    this.dom = domElement;
    this.raft = raft;

    this.pos = new THREE.Vector3(0, 1.6, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eye = 1.6;
    this.speed = 6;
    this.gravity = 20;       // 重力加速度
    this.jumpV = 7.5;        // 起跳初速度
    this.grounded = true;    // 是否站在可起跳的地面（木筏）
    this.airborne = false;   // 是否处于腾空（跳跃中）
    this.jumpQueued = false; // 本帧是否触发起跳（按下空格时置位）
    this.keys = {};
    this.locked = false;

    this._bind();
  }

  _bind() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') {
        e.preventDefault();                   // 阻止空格滚动页面
        if (!e.repeat) this.jumpQueued = true; // 每次按下只排一次起跳
      }
    });
    document.addEventListener('keyup', (e) => (this.keys[e.code] = false));

    this.dom.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
  }

  requestLock() { this.dom.requestPointerLock(); }

  update(dt, ocean, t, frozen = false) {
    if (frozen) this.jumpQueued = false; // 面板打开时禁止起跳（清除排队中的跳跃）
    // 朝向向量
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      0,
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (this.keys['KeyW']) move.add(dir);
    if (this.keys['KeyS']) move.sub(dir);
    if (this.keys['KeyD']) move.add(right);
    if (this.keys['KeyA']) move.sub(right);

    const onRaft = this.raft.isOnRaft(this.pos.x, this.pos.z);
    // 腾空（跳跃中）按满速移动，保证跨过木筏边界时相对输入速度不突变
    const sp = (this.keys['ShiftLeft'] ? this.speed * 1.7 : this.speed) * (onRaft || this.airborne ? 1 : 0.4);
    // 面板打开（frozen）时忽略 WASD 输入，玩家无法自主移动（仍随木筏漂移）
    if (frozen) move.set(0, 0, 0);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(sp * dt);
    this.pos.add(move);

    // 站在木筏上、以及整个跳跃腾空期间，都随木筏漂移一起运动：
    // 把木筏本帧位移施加到玩家身上，使其与木筏保持相对静止。
    // 玩家自身的 WASD 输入（move）叠加其上，即可产生相对木筏的运动。
    // 注意：腾空期间即使已跨出木筏格子也要继续随木筏平移，
    // 否则跨边界的下一帧 onRaft 变 false 会突然停止随木筏移动，导致相对木筏“被甩开”。
    if (onRaft || this.airborne) {
      this.pos.x += this.raft.delta.x;
      this.pos.z += this.raft.delta.z;
    }

    // 站立高度 / 跳跃：起跳时只判断是否在“着地”（grounded），
    // “是否在木筏内”留到落地那一刻再判断（落点在木筏上则停在筏顶，否则落水）。
    // 水中 grounded 为假 → 无法起跳；木筏上起跳后仍随木筏漂移（相对静止），
    // 除非起跳同时朝某方向运动（WASD）。
    const raftTop = this.raft.group.position.y; // 木筏顶面世界高度
    const seaY = ocean.surfaceY(this.pos.x, this.pos.z, t);
    const groundY = raftTop + this.eye;

    // 起跳触发：只要着地即可（不在此判断是否在木筏内）
    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (this.grounded) {
        this.vel.y = this.jumpV;
        this.grounded = false;
        this.airborne = true;
      }
    }

    if (this.airborne) {
      // 腾空：仍随木筏一起平移（上方已施加 raft.delta，保持相对静止），
      // 叠加玩家自身 WASD 水平输入即可相对木筏移动；重力积分直到落到某表面。
      this.vel.y -= this.gravity * dt;
      this.pos.y += this.vel.y * dt;
      // 落地时再判断落点在木筏上还是水里
      const landY = onRaft ? groundY : seaY + 0.3;
      if (this.pos.y <= landY) {
        this.pos.y = landY;
        this.vel.y = 0;
        this.grounded = onRaft; // 落在木筏上才着地，否则落水（不能跳）
        this.airborne = false;
      }
    } else {
      // 未腾空：直接贴合当前表面；水中锁定海面高度且无法起跳
      this.pos.y = onRaft ? groundY : seaY + 0.3;
      this.grounded = onRaft;
    }

    // 应用相机
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}

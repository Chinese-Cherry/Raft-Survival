import * as THREE from 'three';

// 第一人称角色控制器：指针锁定 + WASD + 鼠标视角，
// 站在木筏上时正常行走，落水则减速（游泳）。
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
    this.keys = {};
    this.locked = false;

    this._bind();
  }

  _bind() {
    document.addEventListener('keydown', (e) => (this.keys[e.code] = true));
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

  update(dt, ocean, t) {
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
    const sp = (this.keys['ShiftLeft'] ? this.speed * 1.7 : this.speed) * (onRaft ? 1 : 0.4);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(sp * dt);
    this.pos.add(move);

    // 站在木筏上时，随木筏漂移一起运动（同步位移）
    if (onRaft) {
      this.pos.x += this.raft.delta.x;
      this.pos.z += this.raft.delta.z;
    }

    // 站立高度：筏上跟随木筏高度（视角随筏升降），落水则骑在海面上
    const raftTop = this.raft.group.position.y; // 木筏顶面世界高度
    const seaY = ocean.surfaceY(this.pos.x, this.pos.z, t);
    this.pos.y = onRaft ? raftTop + this.eye : seaY + 0.3;

    // 应用相机
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}

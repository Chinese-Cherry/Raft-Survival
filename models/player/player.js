import * as THREE from 'three';

// 程序化玩家模型（人形，含骨骼层级），可被 Three.js 直接渲染，并支持代码驱动的基础动作。
// 为何不用二进制 .fbx/.glb：手工编写带骨骼动画的二进制模型既不可行也易错，
// 这里用基础几何体拼出可骨骼化的人形，动作（idle/walk/use）由代码每帧解算，
// 等效“可添加动作的模型”，且能无缝接入本项目的 Three.js 管线。
//
// 导出两个可视对象：
//  - group：完整人形，用于第三人称（世界定位，跟随玩家）。
//  - fp：第一人称手臂视角（仅双臂），作为相机的子节点，始终出现在屏幕下方。
// 两者共享同一套骨骼旋转逻辑；getHandWorld() 用于让钩锁从“右手”抛出/收回。

const COL = {
  skin: 0xe8b58b,
  hair: 0x3a2a1a,
  shirt: 0x2f6fb0,
  pants: 0x2b2f3a,
  shoe: 0x161616,
};

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
}

// 以关节为原点、向 -Y 延伸的肢体；旋转该 group 即可绕关节摆动。
function makeLimb(len, radius, color, segs = 6) {
  const pivot = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 2), 4, segs);
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.position.y = -len / 2;
  mesh.castShadow = true;
  pivot.add(mesh);
  pivot.userData.len = len;
  return pivot;
}

// 构建一只手臂：肩(shoulder) → 上臂 → 肘(elbow) → 前臂 → 手(hand)。返回各关节引用。
function buildArm(side, scale = 1) {
  const shoulder = new THREE.Group();
  shoulder.position.set(0.28 * side, 0.5, 0);
  const upper = makeLimb(0.3 * scale, 0.07 * scale, COL.skin);
  shoulder.add(upper);
  const elbow = new THREE.Group();
  elbow.position.y = -0.3 * scale;
  upper.add(elbow);
  const fore = makeLimb(0.3 * scale, 0.06 * scale, COL.shirt);
  elbow.add(fore);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06 * scale, 8, 6), mat(COL.skin));
  hand.position.y = -0.3 * scale;
  elbow.add(hand);
  return { shoulder, elbow, hand };
}

export function buildPlayerModel() {
  const root = new THREE.Group();
  const bones = {};

  // —— 完整人形（第三人称）——
  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);
  bones.hips = hips;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.24), mat(COL.shirt));
  torso.position.y = 0.3; torso.castShadow = true;
  hips.add(torso);
  bones.torso = torso;

  const neck = new THREE.Group();
  neck.position.y = 0.62;
  hips.add(neck);
  bones.neck = neck;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat(COL.skin));
  head.position.y = 0.16; head.castShadow = true;
  neck.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.165, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(COL.hair)
  );
  hair.position.y = 0.16;
  neck.add(hair);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mat(COL.skin));
  nose.position.set(0, 0.15, -0.16); // 正面朝向 -Z（与玩家 forward 一致）
  neck.add(nose);

  const aL = buildArm(1), aR = buildArm(-1);
  hips.add(aL.shoulder); hips.add(aR.shoulder);
  bones.armL = aL.shoulder; bones.elbowL = aL.elbow; bones.handL = aL.hand;
  bones.armR = aR.shoulder; bones.elbowR = aR.elbow; bones.handR = aR.hand;

  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, 0, 0);
    hips.add(hip);
    const upper = makeLimb(0.42, 0.09, COL.pants);
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    upper.add(knee);
    const lower = makeLimb(0.42, 0.08, COL.skin);
    knee.add(lower);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), mat(COL.shoe));
    foot.position.set(0, -0.44, 0.05);
    knee.add(foot);
    return { hip, knee };
  }
  const lL = buildLeg(1), lR = buildLeg(-1);
  bones.legL = lL.hip; bones.kneeL = lL.knee;
  bones.legR = lR.hip; bones.kneeR = lR.knee;

  // —— 第一人称手臂视角（仅双臂，挂在相机下）——
  const fp = new THREE.Group();
  fp.position.set(0, -0.45, -0.7); // 屏幕下方偏前
  const fL = buildArm(1, 1.15), fR = buildArm(-1, 1.15);
  fL.shoulder.position.set(0.28, 0.05, 0);
  fR.shoulder.position.set(-0.28, 0.05, 0);
  fp.add(fL.shoulder); fp.add(fR.shoulder);
  const fpArmL = fL.shoulder, fpArmR = fR.shoulder, fpHand = fR.hand;

  // —— 共享动作状态 ——
  const anim = { time: 0, walkPhase: 0, walkBlend: 0, useTimer: 0, useDur: 0.6 };

  // 第三人称完整模型动画
  function update(dt, state = {}) {
    const moving = !!state.moving;
    anim.time += dt;
    if (anim.useTimer > 0) anim.useTimer -= dt;

    const target = moving ? 1 : 0;
    anim.walkBlend += (target - anim.walkBlend) * Math.min(1, dt * 10);
    anim.walkPhase += dt * (8 + 6 * anim.walkBlend);
    const sw = Math.sin(anim.walkPhase);
    const swing = 0.7 * anim.walkBlend;

    const breathe = Math.sin(anim.time * 1.8) * 0.02;
    hips.position.y = 0.9 + breathe + anim.walkBlend * Math.abs(Math.cos(anim.walkPhase)) * 0.05;
    torso.rotation.x = anim.walkBlend * 0.06;
    neck.rotation.x = Math.sin(anim.time * 1.2) * 0.03;

    bones.legL.rotation.x = sw * swing;
    bones.legR.rotation.x = -sw * swing;
    bones.kneeL.rotation.x = Math.max(0, -sw) * swing * 0.7;
    bones.kneeR.rotation.x = Math.max(0, sw) * swing * 0.7;

    bones.armL.rotation.x = -sw * swing;
    bones.armR.rotation.x = sw * swing;

    if (anim.useTimer > 0) {
      const p = 1 - Math.max(0, anim.useTimer) / anim.useDur;
      const k = Math.sin(p * Math.PI);
      bones.armR.rotation.x = -1.4 * k;
      bones.elbowR.rotation.x = -0.8 * k;
      bones.armR.rotation.z = 0.3 * k;
    } else {
      bones.elbowR.rotation.x = 0;
      bones.armR.rotation.z = 0;
    }
  }

  // 第一人称手臂动画（基础姿态 + 呼吸微摆 + 使用挥动）
  const FP_R = { x: -1.15, z: 0.12 };
  const FP_L = { x: -1.05, z: -0.12 };
  function fpUpdate() {
    const sway = Math.sin(anim.time * 1.5) * 0.03;
    const k = anim.useTimer > 0 ? Math.sin((1 - anim.useTimer / anim.useDur) * Math.PI) : 0;
    fpArmR.rotation.set(FP_R.x + sway - k * 0.7, 0, FP_R.z + k * 0.4);
    fpArmL.rotation.set(FP_L.x + sway, 0, FP_L.z);
  }

  // 触发一次“使用/挥动”动作（右手），第三人称与第一人称共用
  function playUse(dur = 0.6) {
    anim.useDur = dur;
    anim.useTimer = dur;
  }

  // 取右手（或左手）世界坐标。fpMode 为 true 时取第一人称视角中的手（屏幕手部），
  // 否则取第三人称身体上的手。target 为复用的 Vector3。
  function getHandWorld(side, target, fpMode) {
    const src = fpMode ? fpHand : (side === 'right' ? bones.handR : bones.handL);
    src.updateWorldMatrix(true, false);
    return src.getWorldPosition(target);
  }

  return { group: root, bones, fp, update, fpUpdate, playUse, getHandWorld };
}

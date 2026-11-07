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

  // 角色正面朝 -Z，其右手在 +X 一侧（原先左右放反，导致持物手出现在左侧）
  const aL = buildArm(-1), aR = buildArm(1);
  hips.add(aL.shoulder); hips.add(aR.shoulder);
  bones.armL = aL.shoulder; bones.elbowL = aL.elbow; bones.handL = aL.hand;
  bones.armR = aR.shoulder; bones.elbowR = aR.elbow; bones.handR = aR.hand;

  // 第三人称右手持物挂点（跟随手臂/手部动作）
  const gripBody = new THREE.Group();
  gripBody.position.set(0, -0.1, 0);
  bones.handR.add(gripBody);

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
  // 肩关节放在相机右侧外、画面外（x 0.46、y -0.30、z -0.26）：
  // 该处早已在视锥之外，肩部断口不会被看见，也不会被近裁剪面切出缺口；
  // 手臂再近水平地向内前方伸出，于是从画面右下/左下角斜着伸进画面中部，
  // 看到的是完整的小臂+手，而不是悬在眼前的两个断桩。
  const fp = new THREE.Group();
  fp.position.set(0, -0.35, -0.26);
  const fL = buildArm(1, 1.3), fR = buildArm(-1, 1.3);
  fL.shoulder.position.set(-0.46, 0.05, 0); // 左手在屏幕左侧
  fR.shoulder.position.set(0.46, 0.05, 0);  // 右手在屏幕右侧（持物手）

  fp.add(fL.shoulder); fp.add(fR.shoulder);
  const fpArmL = fL.shoulder, fpArmR = fR.shoulder, fpHand = fR.hand;

  // 第一人称右手持物挂点
  const gripFp = new THREE.Group();
  gripFp.position.set(0, -0.1, 0);
  fpHand.add(gripFp);

  // —— 右手持物：第一/第三人称各放一份克隆，随手臂动作 ——
  // 模板已归一化到最大边 0.7；第三人称按真人比例握持，
  // 第一人称离相机近、视角广，需要放大一些才不会显得又小又远。
  const HELD_SCALE_BODY = 0.45;
  const HELD_SCALE_FP = 0.7;
  function clearHeld() {
    for (const g of [gripBody, gripFp]) {
      while (g.children.length) g.remove(g.children[0]);
    }
  }
  function setHeldItem(template) {
    clearHeld();
    if (!template) return; // 没有对应模型：右手不显示任何东西
    for (const [grip, scale] of [[gripBody, HELD_SCALE_BODY], [gripFp, HELD_SCALE_FP]]) {
      const holder = new THREE.Group();
      holder.add(template.clone(true));
      holder.scale.setScalar(scale);
      grip.add(holder);
    }
  }

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
  // x：绕肩向前抬（+X 把 -Y 方向摆向 -Z），手臂这才朝屏幕前方伸出；
  // z：绕肩左右张合，正/负决定手往哪一侧偏 —— 右手取负、左手取正即向中间收；
  // y：绕手臂自身长轴翻转 180°，手（以及挂在手上的物品）朝向整个掉转，
  //    手臂的指向不变，所以看的是“手心/物品正面”翻到了另一侧。
  const FP_R = { x: 1.45, y: Math.PI, z: -0.40 };
  const FP_L = { x: 1.45, y: Math.PI, z: 0.40 };
  function fpUpdate() {
    const sway = Math.sin(anim.time * 1.5) * 0.03;
    const k = anim.useTimer > 0 ? Math.sin((1 - anim.useTimer / anim.useDur) * Math.PI) : 0;
    fpArmR.rotation.set(FP_R.x + sway + k * 0.2, FP_R.y, FP_R.z - k * 0.2);
    fpArmL.rotation.set(FP_L.x + sway, FP_L.y, FP_L.z);
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

  return { group: root, bones, fp, update, fpUpdate, playUse, getHandWorld, setHeldItem };
}

import * as THREE from 'three';

// 动态波浪海面：用顶点着色动画模拟起伏，并提供采样高度供物体随浪浮动。
export class Ocean {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(400, 400, 64, 64);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1b6ca8,
      transparent: true,
      opacity: 0.85,
      roughness: 0.35,
      metalness: 0.1,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = -0.4;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.base = geo.attributes.position.array.slice();
    this.clock = new THREE.Clock();
  }

  // 给定 x,z 与时刻 t 返回相对浪高（与顶点动画一致）。
  heightAt(x, z, t) {
    return (
      Math.sin(x * 0.08 + t * 1.2) * 0.35 +
      Math.cos(z * 0.06 + t * 0.9) * 0.3
    );
  }

  // 海面在世界坐标中的真实高度（网格基准 + 浪高），供木筏/玩家/漂浮物对齐水位。
  surfaceY(x, z, t) {
    return this.mesh.position.y + this.heightAt(x, z, t);
  }

  update(t) {
    if (t === undefined) t = this.clock.getElapsedTime();
    const pos = this.mesh.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = this.base[i];
      const z = this.base[i + 2];
      pos[i + 1] = this.heightAt(x, z, t);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

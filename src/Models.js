import * as THREE from 'three';
import { FBXLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js';

// 食物模型：与 models/food 下的 .fbx 一一对应
export const FOOD_MODELS = ['apple', 'banana', 'orange'];

// 材料模型：与 models/material 下的 .fbx 一一对应
export const MATERIAL_MODELS = ['plastic_sheet', 'rope', 'wood_plank'];

// 归一化：缩放到统一尺寸，并把几何中心移到原点，方便随浪倾斜/旋转
function normalize(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 0.7 / maxDim; // 目标最大边长
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -center.y * s, -center.z * s);
  obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
}

function hasMeshes(obj) {
  let n = 0;
  obj.traverse((o) => { if (o.isMesh) n++; });
  return n > 0;
}

function fallbackMesh() {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.4, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xd14f6a })
  );
  m.castShadow = true;
  return m;
}

// 按文件名加载 ./models/<folder>/<name>.fbx，返回 { name: 归一化后的模板 }
async function loadModels(names, folder) {
  const loader = new FBXLoader();
  const out = {};
  await Promise.all(names.map((name) => new Promise((resolve) => {
    loader.load(
      `./models/${folder}/${name}.fbx`,
      (obj) => {
        normalize(obj);
        out[name] = hasMeshes(obj) ? obj : fallbackMesh();
        resolve();
      },
      undefined,
      () => {
        console.warn('模型加载失败，使用占位盒:', name);
        out[name] = fallbackMesh();
        resolve();
      }
    );
  })));
  return out;
}

// 预加载食物模型（每个只加载一次，之后 spawn 时 clone）
export async function loadFoodModels() {
  return loadModels(FOOD_MODELS, 'food');
}

// 预加载材料模型（木头/塑料/绳索/木材等漂浮物的模型）
export async function loadMaterialModels() {
  return loadModels(MATERIAL_MODELS, 'material');
}

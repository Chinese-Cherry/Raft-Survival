import { FOOD } from './let.js';

// 物品注册表：统一定义所有「可持有物品」的名称、图标、分类。
// category: 'resource' 原材料（显示在快捷栏） / 'food' 食物 / 'tool' 道具（显示在背包）
// icon：优先使用 images/ 下的图片（文件名与物品中文名一致）；无对应图片时退化为 emoji。
//
// 食物条目（名称 / 图标 / 能否直接吃 / 食用恢复的饱食度·水分）全部集中写在
// let.js 的 FOOD 里，这里只负责按 category='food' 组装进注册表，
// 想加新食物或调恢复量，只改 let.js 即可。
const FOOD_ITEMS = Object.fromEntries(
  Object.entries(FOOD).map(([id, f]) => [id, {
    id,
    name: f.name,
    icon: f.icon,
    category: 'food',
    edible: !!f.edible,   // false = 需要烹饪（鱼）
    hunger: f.hunger || 0,
    thirst: f.thirst || 0,
  }])
);

export const ITEMS = {
  // —— 原材料 ——
  plastic: { id: 'plastic', name: '塑料', icon: 'images/塑料.png', category: 'resource' },
  rope:    { id: 'rope',    name: '绳索', icon: 'images/绳索.png', category: 'resource' },
  lumber:  { id: 'lumber',  name: '木材', icon: 'images/木材.png', category: 'resource' },
  leaf:    { id: 'leaf',    name: '树叶', icon: 'images/树叶.png', category: 'resource' },
  // —— 食物（配置见 let.js 的 FOOD）——
  ...FOOD_ITEMS,
  // —— 道具 / 工具 ——
  hook_lock:  { id: 'hook_lock',  name: '钩锁',   icon: 'images/钩锁.png', category: 'tool' },
  fishing_rod:{ id: 'fishing_rod',name: '鱼竿',   icon: 'images/鱼竿.png', category: 'tool' },
  // 木矛：暂无图片素材，先用 emoji 占位（放入 images/木矛.png 即可自动切换为图片）
  wood_spear: { id: 'wood_spear', name: '木矛',   icon: '🗡️',             category: 'tool' },
  // 暂无对应图片，暂用 emoji 占位（放入 images/建造锤.png 即可自动切换为图片）
  build_hammer:{ id: 'build_hammer', name: '建造锤', icon: 'images/建造锤.png', category: 'tool' },
};

export function itemDef(id) { return ITEMS[id]; }

// 物品注册表：统一定义所有「可持有物品」的名称、图标、分类。
// category: 'resource' 原材料（显示在快捷栏） / 'food' 食物 / 'tool' 道具（显示在背包）
// edible: 食物是否可直接食用（鱼需要烹饪，edible=false；苹果/香蕉/橙子可直接吃）
// icon：优先使用 images/ 下的图片（文件名与物品中文名一致）；无对应图片时退化为 emoji。
export const ITEMS = {
  // —— 原材料 ——
  plastic: { id: 'plastic', name: '塑料', icon: 'images/塑料.png', category: 'resource' },
  rope:    { id: 'rope',    name: '绳索', icon: 'images/绳索.png', category: 'resource' },
  lumber:  { id: 'lumber',  name: '木材', icon: 'images/木材.png', category: 'resource' },
  // —— 食物：水果可直接食用 ——
  apple:   { id: 'apple',   name: '苹果', icon: 'images/苹果.png', category: 'food', edible: true },
  banana:  { id: 'banana',  name: '香蕉', icon: 'images/香蕉.png', category: 'food', edible: true },
  orange:  { id: 'orange',  name: '橙子', icon: 'images/橙子.png', category: 'food', edible: true },
  leaf:    { id: 'leaf',    name: '树叶', icon: 'images/树叶.png', category: 'resource' },
  // —— 鱼类（食物，但不可直接食用，需要烹饪）——
  fish_small: { id: 'fish_small', name: '小鱼', icon: 'images/小鱼.png', category: 'food', edible: false },
  bass:       { id: 'bass',       name: '鲈鱼', icon: 'images/鲈鱼.png', category: 'food', edible: false },
  pufferfish: { id: 'pufferfish', name: '河豚', icon: 'images/河豚.png', category: 'food', edible: false },
  salmon:     { id: 'salmon',     name: '鲑鱼', icon: 'images/鲑鱼.png', category: 'food', edible: false },
  tuna:       { id: 'tuna',       name: '金枪鱼', icon: 'images/金枪鱼.png', category: 'food', edible: false },
  // —— 道具 / 工具 ——
  hook_lock:  { id: 'hook_lock',  name: '钩锁',   icon: 'images/钩锁.png', category: 'tool' },
  fishing_rod:{ id: 'fishing_rod',name: '鱼竿',   icon: 'images/鱼竿.png', category: 'tool' },
  // 暂无对应图片，暂用 emoji 占位（放入 images/建造锤.png 即可自动切换为图片）
  build_hammer:{ id: 'build_hammer', name: '建造锤', icon: 'images/建造锤.png', category: 'tool' },
};

export function itemDef(id) { return ITEMS[id]; }

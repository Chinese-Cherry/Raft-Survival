// 物品注册表：统一定义所有物品的名称、图标、分类。
// category: 'resource' 原材料（显示在快捷栏） / 'tool' 道具（显示在背包）
export const ITEMS = {
  // —— 原材料 ——
  plastic: { id: 'plastic', name: '塑料', icon: '🧴', category: 'resource' },
  rope:    { id: 'rope',    name: '绳索', icon: '🪢', category: 'resource' },
  lumber:  { id: 'lumber',  name: '木材', icon: '🟫', category: 'resource' },
  apple:   { id: 'apple',   name: '苹果', icon: '🍎', category: 'resource' },
  banana:  { id: 'banana',  name: '香蕉', icon: '🍌', category: 'resource' },
  orange:  { id: 'orange',  name: '橙子', icon: '🍊', category: 'resource' },
  leaf:    { id: 'leaf',    name: '树叶', icon: '🍃', category: 'resource' },
  // —— 鱼类（钓鱼获得）——
  fish_small: { id: 'fish_small', name: '小鱼', icon: '🐟', category: 'resource' },
  bass:       { id: 'bass',       name: '鲈鱼', icon: '🐠', category: 'resource' },
  pufferfish: { id: 'pufferfish', name: '河豚', icon: '🐡', category: 'resource' },
  salmon:     { id: 'salmon',     name: '鲑鱼', icon: '🍣', category: 'resource' },
  tuna:       { id: 'tuna',       name: '金枪鱼', icon: '🐟', category: 'resource' },

  // —— 道具 / 工具 ——
  hook_lock:  { id: 'hook_lock',  name: '钩锁',   icon: '🪝', category: 'tool' },
  fishing_rod:{ id: 'fishing_rod',name: '鱼竿',   icon: '🎣', category: 'tool' },
  net:        { id: 'net',        name: '渔网',   icon: '🕸️', category: 'tool' },
  spear:      { id: 'spear',      name: '鱼叉',   icon: '🔱', category: 'tool' },
};

export function itemDef(id) { return ITEMS[id]; }

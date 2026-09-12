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

  // —— 道具 / 工具 ——
  hook:       { id: 'hook',       name: '铁钩',   icon: '⚓', category: 'tool' },
  fishing_rod:{ id: 'fishing_rod',name: '鱼竿',   icon: '🎣', category: 'tool' },
  net:        { id: 'net',        name: '渔网',   icon: '🕸️', category: 'tool' },
  spear:      { id: 'spear',      name: '鱼叉',   icon: '🔱', category: 'tool' },
};

export function itemDef(id) { return ITEMS[id]; }

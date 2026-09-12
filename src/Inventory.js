import { itemDef } from './Items.js';

// 背包/物品栏：按物品 id 存数量，支持增减、查询与遍历。
export class Inventory {
  constructor() {
    this.counts = {};
  }

  add(id, n = 1) {
    if (!itemDef(id)) return;
    this.counts[id] = (this.counts[id] || 0) + n;
  }

  has(id, n = 1) {
    return (this.counts[id] || 0) >= n;
  }

  // 仅当数量足够才扣除，返回是否成功。
  consume(id, n = 1) {
    if (!this.has(id, n)) return false;
    this.counts[id] -= n;
    if (this.counts[id] <= 0) delete this.counts[id];
    return true;
  }

  count(id) { return this.counts[id] || 0; }

  // 返回所有数量 > 0 的物品条目，可选按分类过滤。
  entries(category = null) {
    return Object.entries(this.counts)
      .filter(([id, n]) => n > 0 && (!category || itemDef(id)?.category === category))
      .map(([id, n]) => ({ id, n, def: itemDef(id) }));
  }
}

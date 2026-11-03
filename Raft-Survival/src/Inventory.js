import { itemDef } from './Items.js';

// 格子容量与堆叠上限
export const HOTBAR_SIZE = 9;   // 底部快捷栏格数
export const PACK_COLS = 4;
export const PACK_ROWS = 4;
export const PACK_SIZE = PACK_COLS * PACK_ROWS; // 背包 = 4x4 = 16 格
export const STACK_MAX = 30;    // 单格堆叠上限（工具类不可堆叠，上限为 1）

// 背包/物品栏：基于格子的存储。
// hotbar（底部 9 格快捷栏）+ pack（背包 16 格），每格为 {id, n} 或 null。
// 自动处理同类堆叠（不超过上限）与空位填充；工具类不可堆叠。
export class Inventory {
  constructor() {
    this.hotbar = new Array(HOTBAR_SIZE).fill(null); // 每格: {id, n} 或 null
    this.pack = new Array(PACK_SIZE).fill(null);
  }

  // 工具（category==='tool'）不可堆叠；其余资源可堆叠至 STACK_MAX
  isStackable(id) {
    const def = itemDef(id);
    return !!def && def.category !== 'tool';
  }
  maxStack(id) { return this.isStackable(id) ? STACK_MAX : 1; }

  // 扁平视图（快捷栏 + 背包），用于查询/遍历
  get slots() { return [...this.hotbar, ...this.pack]; }

  // 加入物品：先堆到同类未满堆，再放进空位；返回未能放入的剩余数量。
  // 填充顺序：快捷栏优先（始终可见），溢出再进背包。
  add(id, n = 1) {
    const def = itemDef(id);
    if (!def) return n;
    const max = this.maxStack(id);
    let remain = n;

    if (max > 1) {
      for (const area of [this.hotbar, this.pack]) {
        for (let i = 0; i < area.length; i++) {
          const s = area[i];
          if (s && s.id === id && s.n < max) {
            const put = Math.min(max - s.n, remain);
            s.n += put; remain -= put;
            if (remain <= 0) return 0;
          }
        }
      }
    }
    for (const area of [this.hotbar, this.pack]) {
      for (let i = 0; i < area.length; i++) {
        if (!area[i]) {
          const put = Math.min(max, remain);
          area[i] = { id, n: put }; remain -= put;
          if (remain <= 0) return 0;
        }
      }
    }
    return remain; // 放不下的剩余数量
  }

  has(id, n = 1) {
    let t = 0;
    for (const s of this.slots) if (s && s.id === id) t += s.n;
    return t >= n;
  }

  // 仅当总量足够才扣除（跨多格），返回是否成功；扣空后的格子置 null。
  consume(id, n = 1) {
    if (!this.has(id, n)) return false;
    let need = n;
    for (const area of [this.hotbar, this.pack]) {
      for (let i = 0; i < area.length; i++) {
        const s = area[i];
        if (s && s.id === id) {
          const take = Math.min(s.n, need);
          s.n -= take; need -= take;
          if (s.n <= 0) area[i] = null;
          if (need <= 0) return true;
        }
      }
    }
    return true;
  }

  count(id) {
    let t = 0;
    for (const s of this.slots) if (s && s.id === id) t += s.n;
    return t;
  }

  // 返回所有数量 > 0 的格子条目，可选按分类过滤。
  entries(category = null) {
    return this.slots
      .filter((s) => s && (!category || itemDef(s.id)?.category === category))
      .map((s) => ({ id: s.id, n: s.n, def: itemDef(s.id) }));
  }
}

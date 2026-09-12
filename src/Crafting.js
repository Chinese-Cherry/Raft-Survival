// 合成系统：维护配方表，校验物品栏是否满足条件，并执行扣料+产出。
export class Crafting {
  constructor(inventory, onCraft) {
    this.inv = inventory;
    this.onCraft = onCraft; // (recipe) => void
    this.recipes = [
      // structural=true 的配方不产出物品，而是触发建造逻辑
      { id: 'tile', name: '木筏格子', cost: { lumber: 2 },          desc: '扩建木筏', structural: true },
      { id: 'wall', name: '木墙',     cost: { lumber: 3, rope: 1 },  desc: '防御结构', structural: true },
      { id: 'sail', name: '船帆',     cost: { lumber: 4, rope: 2 },  desc: '可操作航行：转动视角掌舵', structural: true },
      // 产出类配方
      { id: 'rope',        name: '绳索',   cost: { plastic: 2 },            output: { id: 'rope', n: 1 },        desc: '由塑料制成' },
      { id: 'hook',        name: '铁钩',   cost: { lumber: 1, rope: 1 },      output: { id: 'hook', n: 1 },        desc: '道具' },
      { id: 'fishing_rod', name: '鱼竿',   cost: { lumber: 2, rope: 1, plastic: 1 }, output: { id: 'fishing_rod', n: 1 }, desc: '道具' },
      { id: 'net',         name: '渔网',   cost: { rope: 3, plastic: 2 },   output: { id: 'net', n: 1 },         desc: '道具' },
      { id: 'spear',       name: '鱼叉',   cost: { lumber: 2, rope: 1 },      output: { id: 'spear', n: 1 },       desc: '道具' },
    ];
  }

  canCraft(recipe) {
    return Object.entries(recipe.cost).every(([t, n]) => this.inv.has(t, n));
  }

  craft(id) {
    const r = this.recipes.find((x) => x.id === id);
    if (!r || !this.canCraft(r)) return false;
    Object.entries(r.cost).forEach(([t, n]) => this.inv.consume(t, n));
    this.onCraft(r);
    return true;
  }
}

// 集中可调参数（临时调试用）。修改面板会直接改这里的数值并实时生效。
// 删除测试代码时：保留本文件即可（它是正式参数来源），只删 src/Debug.js 与 main.js 中的调用。

import { toast } from './Toast.js';

// 漂浮物类型键（与 Resources.TYPES 对应），用于按类型缩放
export const FLOAT_TYPES = ['plastic', 'lumber', 'apple', 'banana', 'orange', 'leaf'];

// 名称 → 物品 id 对照表（加/删 START_ITEMS 时查表用；新增物品请同步 Items.js）
export const ITEM_IDS = {
  // 原材料
  塑料: 'plastic', 木材: 'lumber', 绳索: 'rope',
  苹果: 'apple', 香蕉: 'banana', 橙子: 'orange', 树叶: 'leaf',
  // 鱼类
  小鱼: 'fish_small', 鲈鱼: 'bass', 河豚: 'pufferfish', 鲑鱼: 'salmon', 金枪鱼: 'tuna',
  // 道具 / 工具
  钩锁: 'hook_lock', 鱼竿: 'fishing_rod', 建造锤: 'build_hammer',
};

// 玩家开局默认拥有的物品：物品名称 → 数量（可自由增删条目或改数量，id 及对应名称见上方 ITEM_IDS）
const items = {
  "木材": 10,
  '建造锤': 1,
  "绳索": 5,
};

export function START_ITEMS() {
  const ITEMS = new Map();

  Object.keys(items).forEach(key => {
    // 名称未在 ITEM_IDS 中登记时，把错误提示显示在游戏画面内（替代 alert，不阻塞游玩）
    if (!Object.hasOwn(ITEM_IDS, key)) {
      toast(`未查找到【${key}】所对应的物品ID`);
      return;
    }
    ITEMS.set(ITEM_IDS[key], items[key]);
  });
  return ITEMS;
}
// 开局默认装备的物品 id（须在 START_ITEMS 中；设为 null 表示不装备）
export const START_EQUIPPED = 'hook_lock';

export const CFG = {
  floatScale: {         // 各漂浮物的单独缩放倍率（按类型）
    plastic: 1.0, lumber: 1.0, apple: 0.2, banana: 0.3, orange: 0.2, leaf: 0.1,
  },
  raftDriftSpeed: 2.2,  // 木筏无帆漂移速度
  raftSailSpeed: 4.0,   // 扬帆后的峰值航行速度
  sailRampTime: 5.0,    // 扬帆后航速从漂移速度爬升到峰值所需时间（秒），越小加速越快
  sailTurnSpeed: 0.6,   // 船帆转向角速度（弧度/秒，约 34°/秒），越小转向越慢
  floatSpeedMin: 1.0,   // 漂浮物漂移速度下限
  floatSpeedMax: 2.0,   // 漂浮物漂移速度上限
  hookForce: 0.5,       // 钩锁抛出总力度倍率（等比缩放抛出速度）
  viewDist: 75,        // 视野距离（影响相机远裁剪 / 雾 / 资源生成环）
  startCount: 10,       // 开局漂浮物数量（生成在木筏附近）
  startSpawnMin: 6,     // 开局生成环：距木筏最近距离
  startSpawnMax: 30,    // 开局生成环：距木筏最远距离
  spawnInterval: 0.75,   // 漂浮物持续生成间隔（秒），越小生成越快
  maxItems: 50,         // 场上漂浮物数量上限（达到则暂停生成，营造源源不断之感）
  Debug: false,         // 调试模式：漂浮物就近生成且不移动、木筏不漂移；面板随此开关显隐
};

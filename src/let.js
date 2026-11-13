// 集中可调参数（按用途分组）：修改面板会直接改这里的数值并实时生效。
// 删除测试代码时：保留本文件即可（它是正式参数来源），只删 src/Debug.js 与 main.js 中的调用。
//   RAFT   —— 木筏航行（漂移 / 扬帆 / 转向）
//   FLOAT  —— 漂浮物（生成 / 漂移 / 大小）
//   PLAY   —— 玩家与交互（视野 / 钩锁 / 渔网 / 保底传送）
//   VITALS —— 生存状态（饱食度 / 水分）
//   FOOD   —— 食物（名称 / 图标 / 可否生吃 / 食用恢复量）
//   DEBUG  —— 调试开关
// 以上分组同时也挂在 CONFIG 上（export const CONFIG = { RAFT, FLOAT, PLAY, VITALS, FOOD, DEBUG }），
// 需要一次性拿到全部参数时 import { CONFIG } 即可。

import { toast } from './Toast.js';

// 漂浮物类型键（与 Resources.TYPES 对应），用于按类型缩放。
// 只有材料会漂浮：苹果/香蕉/橙子等可食用物品已从漂浮列表中移除。
export const FLOAT_TYPES = ['plastic', 'lumber', 'leaf'];

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
  "钩锁": 1,
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

// —— 木筏航行 ——
export const RAFT = {
  driftSpeed: 2.2,    // 无帆/收帆时随洋流漂移的速度
  sailSpeed: 3.5,     // 扬帆后的峰值航速上限（实际速度不会超过该值）
  sailRampTime: 5.0,  // 扬帆后从漂移速度爬升到上限所需时间（秒），越小加速越快
  sailTurnSpeed: 0.6, // 船帆转向角速度（弧度/秒，约 34°/秒），越小转向越慢
};

// —— 漂浮物：生成 / 漂移 / 大小 ——
export const FLOAT = {
  scale: {            // 各类型漂浮物的单独缩放倍率（键需与 Resources.TYPES 对应）
    plastic: 1.0, lumber: 1.0, leaf: 0.1,
  },
  speedMin: 1.0,      // 漂移速度下限
  speedMax: 2.0,      // 漂移速度上限
  startCount: 7,      // 开局生成数量（生成在木筏附近）
  startSpawnMin: 6,   // 开局生成环：距木筏最近距离
  startSpawnMax: 30,  // 开局生成环：距木筏最远距离
  spawnInterval: 0.75,// 持续生成间隔（秒），越小生成越快
  maxItems: 50,       // 场上数量上限（达到则暂停生成）
};

// —— 玩家与交互：视野 / 钩锁 / 渔网 / 保底传送 ——
export const PLAY = {
  viewDist: 75,          // 视野距离（影响相机远裁剪 / 雾 / 资源生成环）
  hookForce: 0.5,        // 钩锁抛出总力度倍率（等比缩放抛出速度）
  rescueRange: 30,       // 离木筏超过该距离后，按 Esc 可选择传送回木筏
  netContactRadius: 1.2, // 渔网碰触漂浮物即吸入的半径（网心为圆心；网中格内的漂浮物一定会被吸入）
  netAutoItemInterval: 60.0, // 渔网每隔多少秒自动产出一件随机漂浮物对应物品
};

// —— 生存状态（饱食度 / 水分）——
// 满值 max，每帧按下面的速度（点/秒）下降；耗尽后暂不产生任何惩罚效果。
// 想调快调慢只改这里的两个数字即可（例如 hungerDrain: 1 → 100 秒耗完）。
export const VITALS = {
  max: 100,             // 初始 / 上限值
  hungerDrain: 0.5,    // 饱食度消耗速度（点/秒）
  thirstDrain: 0.75,    // 水分消耗速度（点/秒）
};

// —— 调试 ——
export const DEBUG = {
  enabled: false,     // 调试模式：漂浮物就近生成且不移动、木筏不漂移；面板随此开关显隐
};

// —— 食物：可食用性与食用效果 ——
// edible：能否直接生吃（鱼需要烹饪）；hunger / thirst：吃下后恢复的饱食度 / 水分。
// 名称与图标也放在这里，Items.js 会用这份表生成食物条目，改数值/加新食物只改这一处。
export const FOOD = {
  apple: { name: '苹果', icon: 'images/苹果.png', edible: true, hunger: 18, thirst: 5 },
  banana: { name: '香蕉', icon: 'images/香蕉.png', edible: true, hunger: 24, thirst: -1 },
  orange: { name: '橙子', icon: 'images/橙子.png', edible: true, hunger: 14, thirst: 8 },
  fish_small: { name: '小鱼', icon: 'images/小鱼.png', edible: false, hunger: 12, thirst: 0 },
  bass: { name: '鲈鱼', icon: 'images/鲈鱼.png', edible: false, hunger: 22, thirst: 0 },
  pufferfish: { name: '河豚', icon: 'images/河豚.png', edible: false, hunger: 10, thirst: 0 },
  salmon: { name: '鲑鱼', icon: 'images/鲑鱼.png', edible: false, hunger: 28, thirst: 0 },
  tuna: { name: '金枪鱼', icon: 'images/金枪鱼.png', edible: false, hunger: 34, thirst: 0 },
};

// —— 统一出口 ——
// CONFIG 里放的是上面同一批对象（引用相同）：`CONFIG.RAFT.driftSpeed` 与
// `RAFT.driftSpeed` 指向同一个值，改任一处都实时生效。
// 想一次拿到全部参数（如调试面板、存档）用 CONFIG；只关心某一块时按需取单个分组更简洁。
export const CONFIG = { RAFT, FLOAT, PLAY, VITALS, FOOD, DEBUG };

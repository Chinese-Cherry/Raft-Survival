// 集中可调参数（临时调试用）。修改面板会直接改这里的数值并实时生效。
// 删除测试代码时：保留本文件即可（它是正式参数来源），只删 src/Debug.js 与 main.js 中的调用。

// 漂浮物类型键（与 Resources.TYPES 对应），用于按类型缩放
export const FLOAT_TYPES = ['plastic', 'rope', 'lumber', 'apple', 'banana', 'orange', 'leaf'];

export const CFG = {
  floatScale: {         // 各漂浮物的单独缩放倍率（按类型）
    plastic: 1.0, rope: 1.1, lumber: 1.0, apple: 0.2, banana: 0.3, orange: 0.2, leaf: 0.1,
  },
  raftDriftSpeed: 2.2,  // 木筏无帆漂移速度
  raftSailSpeed: 4.0,   // 木筏有帆航行速度
  floatSpeedMin: 1.0,   // 漂浮物漂移速度下限
  floatSpeedMax: 2.0,   // 漂浮物漂移速度上限
  hookForce: 0.5,       // 钩锁抛出总力度倍率（等比缩放抛出速度）
  viewDist: 110,        // 视野距离（影响相机远裁剪 / 雾 / 资源生成环）
  startCount: 14,       // 开局漂浮物数量（生成在木筏附近）
  startSpawnMin: 6,     // 开局生成环：距木筏最近距离
  startSpawnMax: 30,    // 开局生成环：距木筏最远距离
  spawnInterval: 1.5,   // 漂浮物持续生成间隔（秒），越小生成越快
  Debug: false,         // 调试模式：漂浮物就近生成且不移动、木筏不漂移；面板随此开关显隐
};

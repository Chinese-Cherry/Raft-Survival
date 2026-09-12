import { Game } from './Game.js';
import { loadFoodModels } from './Models.js';
import { createDebugPanel } from './Debug.js'; // 临时调试面板（测试代码，可删除）

// 入口：先预加载食物模型，再启动游戏。
window.addEventListener('DOMContentLoaded', async () => {
  const foodModels = await loadFoodModels();
  const game = new Game(foodModels);
  createDebugPanel(game, game.raft, game.resources); // 临时调试面板（测试代码，可删除）
});

import { Game } from './Game.js';
import { loadFoodModels, loadMaterialModels } from './Models.js';
import { createDebugPanel } from './Debug.js'; // 临时调试面板（测试代码，可删除）

// 入口：先预加载食物与材料模型，再启动游戏。
window.addEventListener('DOMContentLoaded', async () => {
  const [foodModels, materialModels] = await Promise.all([
    loadFoodModels(),
    loadMaterialModels(),
  ]);
  const models = { ...foodModels, ...materialModels };
  const game = new Game(models);
  createDebugPanel(game, game.raft, game.resources); // 临时调试面板（测试代码，可删除）
});

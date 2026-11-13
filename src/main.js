import { Game } from './Game.js';
import { loadFoodModels, loadMaterialModels, loadEquipModels } from './Models.js';
import { createDebugPanel } from './Debug.js'; // 临时调试面板（测试代码，可删除）

// 入口：先预加载食物、材料与装备模型，再启动游戏。
window.addEventListener('DOMContentLoaded', async () => {
  const [foodModels, materialModels, equipModels] = await Promise.all([
    loadFoodModels(),
    loadMaterialModels(),
    loadEquipModels(),
  ]);
  const models = { ...foodModels, ...materialModels, ...equipModels };
  const game = new Game(models);
  createDebugPanel(game, game.raft, game.resources); // 临时调试面板（测试代码，可删除）
});

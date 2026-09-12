import { CFG, FLOAT_TYPES } from './let.js';
import { TYPES } from './Resources.js';

// ────────────────────────────────────────────────────────────────────────
// 临时调试面板：运行时拖动滑块即可修改 CFG 中的关键参数并实时生效。
// 这是"测试代码"，调试完毕后：删除本文件 + 删除 main.js 中的那一行
// `createDebugPanel(...)` 调用即可，不会影响游戏正式逻辑。
// ────────────────────────────────────────────────────────────────────────
export function createDebugPanel(game, raft, resources) {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:9999;' +
    'background:rgba(0,0,0,.65);color:#fff;font:12px/1.5 monospace;' +
    'padding:12px;border-radius:8px;width:230px;pointer-events:auto;';

  const title = document.createElement('div');
  title.innerHTML = '<b>调试面板</b>（临时）';
  title.style.marginBottom = '8px';
  panel.appendChild(title);

  // 通用滑块构造器：label 文本、初始值、onInput 回调
  function addSlider(text, init, onInput, min, max, step) {
    const row = document.createElement('div');
    row.style.marginTop = '6px';
    const label = document.createElement('div');
    label.innerHTML = `${text}: <span>${init}</span>`;
    row.appendChild(label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = init;
    input.style.width = '100%';
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      label.querySelector('span').textContent = v;
      onInput(v);
    });
    row.appendChild(input);
    panel.appendChild(row);
  }

  // —— 通用标量参数 ——
  addSlider('视野距离', CFG.viewDist, (v) => { CFG.viewDist = v; game.applyViewDist(v); }, 20, 250, 1);

  // —— 漂浮物大小（按类型单独可调）——
  const sep = document.createElement('div');
  sep.textContent = '— 漂浮物大小（按类型）—';
  sep.style.cssText = 'margin-top:10px;opacity:.7;';
  panel.appendChild(sep);
  for (const type of FLOAT_TYPES) {
    const name = TYPES[type] ? TYPES[type].label : type;
    addSlider(name, CFG.floatScale[type], (v) => (CFG.floatScale[type] = v), 0.2, 4, 0.05);
  }

  // 面板初始显隐跟随调试模式
  panel.style.display = CFG.Debug ? 'block' : 'none';
  document.body.appendChild(panel);

  // // 常驻"调试模式"开关：切换 CFG.Debug，面板随之显示/隐藏，并重新布置漂浮物
  // const toggle = document.createElement('button');
  // const syncLabel = () => (toggle.textContent = `调试模式: ${CFG.Debug ? '开' : '关'}`);
  // toggle.style.cssText =
  //   'position:fixed;bottom:12px;left:12px;z-index:9998;' +
  //   'padding:6px 12px;cursor:pointer;font:13px sans-serif;' +
  //   'background:rgba(0,0,0,.6);color:#fff;border:1px solid #fff;border-radius:6px;';
  // syncLabel();
  // toggle.onclick = () => {
  //   CFG.Debug = !CFG.Debug;
  //   panel.style.display = CFG.Debug ? 'block' : 'none';
  //   syncLabel();
  //   if (resources.resetForDebug) resources.resetForDebug();
  // };
  // document.body.appendChild(toggle);
}

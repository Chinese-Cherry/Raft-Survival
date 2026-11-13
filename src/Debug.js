import { RAFT, FLOAT, PLAY, VITALS, DEBUG, FLOAT_TYPES } from './let.js';
import { TYPES } from './Resources.js';

// ────────────────────────────────────────────────────────────────────────
// 临时调试面板：可滚动的参数列表。每一项 = 数字输入框 + 滑块，两者双向同步，
// 数字可以直接键入（失焦时会纠正非法/越界值）。改动的是 let.js 里
// RAFT / FLOAT / PLAY / VITALS 中的同一个对象，保存即实时生效。
// 这是"测试代码"，调试完毕后：删除本文件 + 删除 main.js 中的那一行
// `createDebugPanel(...)` 调用即可，不会影响游戏正式逻辑。
// ────────────────────────────────────────────────────────────────────────
export function createDebugPanel(game, raft, resources) {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:9999;' +
    'background:rgba(0,0,0,.68);color:#fff;font:12px/1.5 monospace;' +
    'border-radius:8px;width:280px;pointer-events:auto;' +
    // 参数较多：面板自身滚动，高度不超过窗口
    'max-height:calc(100vh - 24px);overflow-y:auto;overflow-x:hidden;' +
    'scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.35) transparent;';

  // 标题吸顶：滚动时始终可见
  const title = document.createElement('div');
  title.innerHTML = '<b>调试面板</b>（临时 · 可滚动）';
  title.style.cssText =
    'position:sticky;top:0;z-index:1;padding:8px 10px;' +
    'background:rgba(10,10,10,.92);border-bottom:1px solid rgba(255,255,255,.15);' +
    'border-radius:8px 8px 0 0;';
  panel.appendChild(title);

  const body = document.createElement('div');
  body.style.cssText = 'padding:2px 10px 12px;';
  panel.appendChild(body);

  // 分组小标题
  function addSection(text) {
    const el = document.createElement('div');
    el.textContent = `— ${text} —`;
    el.style.cssText = 'margin:12px 0 0;opacity:.65;';
    body.appendChild(el);
  }

  // 一行参数：名称 + 数字输入框（可直接键入），下面一条同步的滑块。
  // get/set 用函数传入，因为参数是原始值，改的必须是 let.js 里那个字段本身。
  function addSlider(text, get, set, min, max, step) {
    const row = document.createElement('div');
    row.style.marginTop = '8px';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const label = document.createElement('span');
    label.textContent = text; // 用 textContent，避免文本被当作 HTML 解析
    label.style.cssText = 'flex:1;opacity:.9;';

    const num = document.createElement('input');
    num.type = 'number';
    num.step = step; num.min = min; num.max = max;
    num.value = get();
    num.style.cssText =
      'width:68px;background:rgba(255,255,255,.12);color:#fff;' +
      'border:1px solid rgba(255,255,255,.25);border-radius:4px;' +
      'font:12px monospace;padding:1px 4px;text-align:right;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min; slider.max = max; slider.step = step;
    slider.value = get();
    slider.style.cssText = 'width:100%;margin:2px 0 0;';

    // 滑块 → 数字框
    slider.addEventListener('input', () => {
      num.value = slider.value;
      set(parseFloat(slider.value));
    });
    // 数字框 → 滑块（边打字边生效；"0." 这类中间态先忽略）
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (!Number.isFinite(v)) return;
      const c = Math.min(max, Math.max(min, v));
      slider.value = c;
      set(c);
    });
    // 失焦时把空值/越界值纠正回合法值，避免输入框与真实参数不一致
    num.addEventListener('blur', () => {
      const v = parseFloat(num.value);
      const c = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : get();
      num.value = c;
      slider.value = c;
      set(c);
    });

    head.appendChild(label);
    head.appendChild(num);
    row.appendChild(head);
    row.appendChild(slider);
    body.appendChild(row);
  }

  // —— 视野与交互（PLAY）——
  addSection('视野 / 交互');
  addSlider('视野距离', () => PLAY.viewDist,
    (v) => { PLAY.viewDist = v; game.applyViewDist(v); }, 20, 250, 1);
  addSlider('钩锁力度', () => PLAY.hookForce, (v) => (PLAY.hookForce = v), 0.1, 3, 0.05);
  addSlider('传送回筏距离', () => PLAY.rescueRange, (v) => (PLAY.rescueRange = v), 5, 120, 1);
  addSlider('渔网吸入半径', () => PLAY.netContactRadius, (v) => (PLAY.netContactRadius = v), 0.3, 5, 0.1);
  addSlider('渔网产出间隔', () => PLAY.netAutoItemInterval, (v) => (PLAY.netAutoItemInterval = v), 1, 300, 1);

  // —— 木筏航行（RAFT）——
  addSection('木筏航行');
  addSlider('漂移速度', () => RAFT.driftSpeed, (v) => (RAFT.driftSpeed = v), 0.5, 8, 0.1);
  addSlider('船帆速度上限', () => RAFT.sailSpeed, (v) => (RAFT.sailSpeed = v), 0.5, 12, 0.1);
  addSlider('帆力爬升时间', () => RAFT.sailRampTime, (v) => (RAFT.sailRampTime = v), 0.5, 20, 0.5);
  addSlider('船帆转向速度', () => RAFT.sailTurnSpeed, (v) => (RAFT.sailTurnSpeed = v), 0.1, 3, 0.05);

  // —— 漂浮物：漂移与生成（FLOAT）——
  addSection('漂浮物生成 / 漂移');
  addSlider('漂移速度下限', () => FLOAT.speedMin, (v) => (FLOAT.speedMin = v), 0, 8, 0.1);
  addSlider('漂移速度上限', () => FLOAT.speedMax, (v) => (FLOAT.speedMax = v), 0, 8, 0.1);
  addSlider('生成间隔', () => FLOAT.spawnInterval, (v) => (FLOAT.spawnInterval = v), 0.1, 5, 0.05);
  addSlider('数量上限', () => FLOAT.maxItems, (v) => (FLOAT.maxItems = v), 5, 200, 1);

  // —— 漂浮物大小（按类型单独可调）——
  addSection('漂浮物大小（按类型）');
  for (const type of FLOAT_TYPES) {
    const name = TYPES[type] ? TYPES[type].label : type;
    addSlider(name, () => FLOAT.scale[type], (v) => (FLOAT.scale[type] = v), 0.1, 4, 0.05);
  }

  // —— 生存状态（VITALS）——
  addSection('生存状态');
  addSlider('饱食度消耗/秒', () => VITALS.hungerDrain, (v) => (VITALS.hungerDrain = v), 0, 5, 0.05);
  addSlider('水分消耗/秒', () => VITALS.thirstDrain, (v) => (VITALS.thirstDrain = v), 0, 5, 0.05);

  // 面板初始显隐跟随调试模式
  panel.style.display = DEBUG.enabled ? 'block' : 'none';
  document.body.appendChild(panel);

  // // 常驻"调试模式"开关：切换 DEBUG.enabled，面板随之显示/隐藏，并重新布置漂浮物
  // const toggle = document.createElement('button');
  // const syncLabel = () => (toggle.textContent = `调试模式: ${DEBUG.enabled ? '开' : '关'}`);
  // toggle.style.cssText =
  //   'position:fixed;bottom:12px;left:12px;z-index:9998;' +
  //   'padding:6px 12px;cursor:pointer;font:13px sans-serif;' +
  //   'background:rgba(0,0,0,.6);color:#fff;border:1px solid #fff;border-radius:6px;';
  // syncLabel();
  // toggle.onclick = () => {
  //   DEBUG.enabled = !DEBUG.enabled;
  //   panel.style.display = DEBUG.enabled ? 'block' : 'none';
  //   syncLabel();
  //   if (resources.resetForDebug) resources.resetForDebug();
  // };
  // document.body.appendChild(toggle);
}

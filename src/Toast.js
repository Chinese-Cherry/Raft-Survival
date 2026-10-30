// 屏幕浮动提示：替代 alert()，把信息显示在游戏画面内（不阻塞操作，自动淡出）。
// 供无法访问 UI/Game 实例的模块（如 let.js 的配置解析）使用。
let el = null;
let hideTimer = null;

export function toast(text, duration = 3500) {
  if (typeof document === 'undefined' || !document.body) return;
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText =
      'position:fixed;top:16%;left:50%;transform:translateX(-50%);z-index:10000;' +
      'max-width:70%;padding:10px 18px;border-radius:10px;background:rgba(160,24,24,.9);' +
      'color:#fff;font:15px/1.5 system-ui,sans-serif;text-align:center;' +
      'pointer-events:none;opacity:0;transition:opacity .2s;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

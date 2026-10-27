import { ITEMS } from "./Items.js";
import { HOTBAR_SIZE, PACK_SIZE } from "./Inventory.js";

// HUD/UI 管理：底部快捷栏（9格）、背包面板（4x4 固定格子）、交互提示、合成面板、指针锁定遮罩。
export class UI {
  constructor(inventory, crafting, game) {
    this.inv = inventory;
    this.crafting = crafting;
    this.game = game;
    this.activeSlot = 0; // 当前选中的快捷栏格

    this.elPrompt = document.getElementById("prompt");
    this.elCraft = document.getElementById("crafting");
    this.elRecipes = document.getElementById("recipe-list");
    this.elBackpack = document.getElementById("backpack");
    this.elBackpackGrid = document.getElementById("backpack-grid");
    this.elSail = document.getElementById("sail-panel");
    this.elSailState = document.getElementById("sail-state");
    this.elSailToggle = document.getElementById("sail-toggle");
    this.elSailClose = document.getElementById("sail-close");
    this.elHotbar = document.getElementById("hotbar");
    this.elEquipped = document.getElementById("equipped");
    this.elCharge = document.getElementById("charge");
    this.elChargeFill = this.elCharge.querySelector("i");
    this.elOverlay = document.getElementById("overlay");
    this.elApp = document.getElementById("app");

    this.openPanel = null; // 当前打开的面板：'crafting' | 'backpack' | 'sail' | null

    // 船帆互动面板：开/收帆、转向
    this.elSailToggle.addEventListener("click", () => {
      this.game.toggleSail();
      this.renderSail();
    });
    document.getElementById("sail-set").addEventListener("click", () => {
      // 关闭面板后进入“转动视角定航向”模式，玩家确认时才固定方向
      this.game.beginSailAim();
    });
    this.elSailClose.addEventListener("click", () => this._closePanels());

    this.elOverlay.addEventListener("click", () => {
      if (this.openPanel) return;
      game.player.requestLock();
      this.elOverlay.style.display = "none";
    });

    this.elApp.addEventListener("click", () => {
      if (this.openPanel) return; // 面板打开时不重新锁定（保留鼠标）
      game.player.requestLock();
    });

    document.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") this.toggleCrafting();
      if (e.code === "KeyB") this.toggleBackpack();
      if (/^Digit[1-9]$/.test(e.code) && !this.openPanel) this.selectSlot(+e.code.slice(5) - 1);
    });

    // 滚轮循环切换快捷栏选中格（面板打开时不切换）
    document.addEventListener("wheel", (e) => {
      if (this.openPanel) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = (this.activeSlot + dir + HOTBAR_SIZE) % HOTBAR_SIZE;
      this.selectSlot(next);
    }, { passive: false });

    this.renderRecipes();
    this.renderBackpack();
    this.renderHotbar();
  }

  // 渲染单格（快捷栏/背包通用）。slot 为 null 时显示空格子。
  cellHTML(slot, idx, opts = {}) {
    const cls = (opts.cls || "cell") + (opts.active ? " active" : "");
    const num = opts.num ? `<span class="num">${idx + 1}</span>` : "";
    if (!slot) return `<div class="${cls}" data-idx="${idx}">${num}</div>`;
    const def = ITEMS[slot.id];
    const cnt = slot.n > 1 ? `<span class="cnt">${slot.n}</span>` : "";
    // icon 为图片路径（含扩展名）时渲染 <img>，否则按原 emoji 文本显示
    const ico = /\.(png|jpe?g|gif|webp)$/i.test(def.icon)
      ? `<img class="ico" src="${def.icon}" alt="${def.name}">`
      : `<span class="ico">${def.icon}</span>`;
    return `<div class="${cls}" data-idx="${idx}" title="${def.name}">
      ${num}
      ${ico}
      <span class="nm">${def.name}</span>
      ${cnt}
    </div>`;
  }

  // 底部快捷栏：9 格，始终显示；点击或按 1-9 选中（工具类选中即装备）。
  renderHotbar() {
    this.elHotbar.innerHTML = this.inv.hotbar
      .map((s, i) => this.cellHTML(s, i, { cls: "slot", active: i === this.activeSlot, num: true }))
      .join("");
    this.elHotbar.querySelectorAll(".slot").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.selectSlot(+el.dataset.idx);
      });
    });
  }

  // 背包面板：4x4=16 格固定格子（无物品显示空格子）；点击工具类格子可装备。
  renderBackpack() {
    let cells = "";
    for (let i = 0; i < PACK_SIZE; i++) cells += this.cellHTML(this.inv.pack[i], i, { cls: "cell" });
    this.elBackpackGrid.innerHTML = cells;
    this.elBackpackGrid.querySelectorAll(".cell").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const s = this.inv.pack[+el.dataset.idx];
        if (s && ITEMS[s.id]?.category === "tool") this.game._equip(s.id);
      });
    });
  }

  refreshCounts() {
    this.renderHotbar();
    this.renderBackpack();
    this.renderRecipes();
  }

  // 选中快捷栏格：格内是工具则装备，切到其他格（空/非工具）则卸下。
  selectSlot(i) {
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.activeSlot = i;
    const s = this.inv.hotbar[i];
    if (s && ITEMS[s.id]?.category === "tool") this.game._equip(s.id);
    else this.game._equip(null);
    this.renderHotbar();
  }

  setPrompt(text) {
    if (text) {
      this.elPrompt.style.display = "block";
      this.elPrompt.textContent = text;
    } else this.elPrompt.style.display = "none";
  }

  setEquipped(id) {
    if (!id) { this.elEquipped.style.display = "none"; return; }
    const def = ITEMS[id];
    const hint = (id === 'hook_lock' || id === 'fishing_rod') ? '左键蓄力抛出'
               : (id === 'build_hammer') ? '合成菜单选择建筑后放置'
               : '左键 使用';
    this.elEquipped.style.display = "block";
    // 装备提示只显示文字，避免图片以原始尺寸撑大遮挡游玩画面
    this.elEquipped.innerHTML =
      `<span class="key">[已装备]</span>${def.name}　<span style="opacity:.6">${hint}</span>`;
  }

  // 蓄力条：p 为 0~1 的进度；传 null 隐藏。
  setCharge(p) {
    if (p == null) { this.elCharge.style.display = "none"; return; }
    this.elCharge.style.display = "block";
    this.elChargeFill.style.width = Math.max(0, Math.min(100, p * 100)) + "%";
  }

  // 打开/切换面板。若已有另一面板打开则禁止打开（互斥）；
  // 打开时释放鼠标（退出指针锁定），关闭（最后一个关闭）时重新锁定。
  _openPanel(which) {
    if (this.openPanel && this.openPanel !== which) return; // 另一个面板已开，禁止打开
    if (this.openPanel === which) { this._closePanels(); return; } // 再次按下则关闭
    if (this.game.aimingSail) this.game.cancelSailAim(); // 打开任意面板时退出定航向模式
    if (which === 'crafting') {
      this.game.cancelBuild(); // 重新打开合成菜单时退出建造模式（幽灵格隐藏）
      this.elCraft.style.display = 'block';
      this.renderRecipes();
    } else if (which === 'sail') {
      this.game.cancelBuild(); // 打开船帆面板时同时退出建造模式
      this.renderSail();
      this.elSail.style.display = 'block';
    } else {
      this.elBackpack.style.display = 'block';
      this.renderBackpack();
    }
    this.openPanel = which;
    document.exitPointerLock?.(); // 显示鼠标
  }

  _closePanels() {
    this.elCraft.style.display = 'none';
    this.elBackpack.style.display = 'none';
    if (this.elSail) this.elSail.style.display = 'none';
    this.openPanel = null;
    this.game.player.requestLock(); // 全部关闭后重新锁定指针
  }

  // 供 Game 在 Esc / 代码中关闭面板
  closePanels() {
    if (this.openPanel) this._closePanels();
  }

  toggleCrafting() { this._openPanel('crafting'); }
  toggleBackpack() { this._openPanel('backpack'); }
  toggleSailPanel() { this._openPanel('sail'); }

  // 船帆面板：显示展开状态与当前固定航向
  renderSail() {
    const raft = this.game.raft;
    if (!raft.hasSail) return;
    this.elSailState.innerHTML =
      `${raft.sailOpen ? '状态：已展开（按航向航行）' : '状态：已收起（随洋流漂移）'}<br/>` +
      `当前航向：${this._sailHeading()}`;
    this.elSailToggle.textContent = raft.sailOpen ? '收起船帆' : '展开船帆';
  }

  // 航向角度 → 八方位文字（0°=北，顺时针）
  _sailHeading() {
    return this.game._headingText(this.game.raft.sailYaw);
  }

  renderRecipes() {
    // 手持建造锤时只显示木筏建筑配方；反之只显示道具/材料配方
    const structMode = this.game.equipped === 'build_hammer';
    const list = this.crafting.recipes.filter((r) => (r.structural === true) === structMode);
    this.elRecipes.innerHTML = list
      .map((r) => {
        const ok = this.crafting.canCraft(r);
        const cost = Object.entries(r.cost)
          .map(([t, n]) => `${ITEMS[t]?.name || t}x${n}`)
          .join(" ");
        return `<div class="recipe ${ok ? "" : "locked"}" data-id="${r.id}">
        <span>${r.name}<br/><small style="opacity:.6">${cost}</small></span>
        <span>${ok ? "✓" : "✗"}</span>
      </div>`;
      })
      .join("");

    this.elRecipes.querySelectorAll(".recipe").forEach((el) => {
      el.addEventListener("click", () => {
        const r = this.crafting.recipes.find((x) => x.id === el.dataset.id);
        if (r.place) {
          // 选中可放置建筑：先判断能否建造，能建造才进入建造模式（幽灵格随之出现）
          if (!this.crafting.canCraft(r)) {
            // 用浮动提示，避免被主循环每帧刷新的 prompt 覆盖
            this.game._flash('无法建造（材料不足）', 1.5);
            return;
          }
          // 进入建造模式成功才关闭菜单；失败（如船帆已建）保留面板并给出提示
          if (this.game.selectBuild(r.id)) this._closePanels();
          return;
        }
        if (!this.crafting.canCraft(r)) {
          // 木筏类建筑（含渔网）材料不足时统一提示"无法建造"
          this.setPrompt(r.structural ? '无法建造（材料不足）' : '材料不足，无法合成');
          return;
        }
        this.crafting.craft(r.id);
        this.refreshCounts();
      });
    });
  }
}

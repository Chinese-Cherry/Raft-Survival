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
    // 渔网储物面板（与背包同样式：4x4 格，点格取出到背包）
    this.elNet = document.getElementById("net-panel");
    this.elNetGrid = document.getElementById("net-grid");
    this.elNetInfo = document.getElementById("net-info");
    this.currentNet = null;
    // 远离木筏时的传送确认面板（Esc 触发）
    this.elRescue = document.getElementById("rescue-panel");
    this.elRescueInfo = document.getElementById("rescue-info");
    this.elHotbar = document.getElementById("hotbar");
    this.elEquipped = document.getElementById("equipped");
    this.elCharge = document.getElementById("charge");
    this.elChargeFill = this.elCharge.querySelector("i");
    this.elOverlay = document.getElementById("overlay");
    this.elApp = document.getElementById("app");

    this.openPanel = null; // 当前打开的面板：'crafting' | 'backpack' | 'sail' | 'net' | null
    this.picked = null;    // 当前选中的格子：{ area: 'hotbar'|'pack'|'net', idx }
    // 交互提示的自动消失计时（左上角游玩说明为静态内容，不走这里）
    this._promptText = '';
    this._promptUntil = 0;

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

    // 渔网面板：全部取出 / 关闭
    document.getElementById("net-take-all").addEventListener("click", () => {
      if (this.currentNet) this.game.takeAllNetItems(this.currentNet);
    });
    document.getElementById("net-close").addEventListener("click", () => this._closePanels());

    // 传送确认面板：传送回木筏 / 继续探索
    document.getElementById("rescue-confirm").addEventListener("click", () => this.game.teleportToRaft());
    document.getElementById("rescue-cancel").addEventListener("click", () => this._closePanels());

    // 设置面板（Esc 暂停时打开）：每个音频通道一行，含开关与音量滑条
    this.elSettings = document.getElementById("settings-panel");
    document.getElementById("settings-resume").addEventListener("click", () => this._closePanels());
    this.elSettings.querySelectorAll(".setting-row").forEach((row) => {
      const ch = row.dataset.ch;
      row.querySelector(".s-toggle").addEventListener("change", (e) => {
        this.game.audio.setEnabled(ch, e.target.checked);
        this._syncSettingRow(row);
      });
      row.querySelector(".s-vol").addEventListener("input", (e) => {
        this.game.audio.setVolume(ch, +e.target.value / 100);
        this._syncSettingRow(row);
      });
    });

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

  // 渲染单格（快捷栏/背包/渔网通用）。slot 为 null 时显示空格子。
  cellHTML(slot, idx, opts = {}) {
    const cls = (opts.cls || "cell") + (opts.active ? " active" : "") + (opts.picked ? " picked" : "");
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

  // 底部快捷栏：9 格，始终显示；无面板时点击即选中（工具类选中即装备），
  // 面板打开时点击改为"选中格子"，用于和另一个格子交换物品。
  renderHotbar() {
    this.elHotbar.innerHTML = this.inv.hotbar
      .map((s, i) => this.cellHTML(s, i, {
        cls: "slot",
        active: i === this.activeSlot,
        num: true,
        picked: this._isPicked('hotbar', i),
      }))
      .join("");
    this.elHotbar.querySelectorAll(".slot").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const i = +el.dataset.idx;
        // 背包/渔网面板打开时：快捷栏格子也参与"选两格交换"
        if (this._swapMode()) this.pickCell('hotbar', i);
        else this.selectSlot(i);
      });
    });
  }

  // 背包面板：4x4=16 格固定格子（无物品显示空格子）。
  // 点击 = 选中/交换两个格子；双击工具类格子 = 装备。
  renderBackpack() {
    let cells = "";
    for (let i = 0; i < PACK_SIZE; i++) {
      cells += this.cellHTML(this.inv.pack[i], i, { cls: "cell", picked: this._isPicked('pack', i) });
    }
    this.elBackpackGrid.innerHTML = cells;
    this.elBackpackGrid.querySelectorAll(".cell").forEach((el) => {
      const idx = +el.dataset.idx;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.pickCell('pack', idx);
      });
      el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        const s = this.inv.pack[idx];
        if (s && ITEMS[s.id]?.category === "tool") this.game._equip(s.id);
      });
    });
  }

  // —— 格子选中 / 交换 ——
  // 所有显示物品的格子（快捷栏 / 背包 / 渔网储物格）共用一套逻辑：
  // 第一次点击选中一格（高亮），再点另一格即把两格内容互换；点同一格取消选中。
  // 是否处于"格子交换"状态（背包/渔网面板显示时）
  _swapMode() { return this.openPanel === 'backpack' || this.openPanel === 'net'; }

  _areaSlots(area) {
    if (area === 'hotbar') return this.inv.hotbar;
    if (area === 'pack') return this.inv.pack;
    if (area === 'net' && this.currentNet) return this.currentNet.storage;
    return null;
  }

  _isPicked(area, idx) {
    const p = this.picked;
    return !!p && p.area === area && p.idx === idx;
  }

  // 只更新"选中"高亮（不重建 DOM，避免双击失效）
  _applyPickedHighlight() {
    document.querySelectorAll('.cell.picked, .slot.picked')
      .forEach((el) => el.classList.remove('picked'));
    if (!this.picked) return;
    const p = this.picked;
    const box = p.area === 'hotbar' ? this.elHotbar
      : p.area === 'pack' ? this.elBackpackGrid
        : this.elNetGrid;
    const el = box && box.querySelector(`[data-idx="${p.idx}"]`);
    if (el) el.classList.add('picked');
  }

  pickCell(area, idx) {
    const slots = this._areaSlots(area);
    if (!slots || idx < 0 || idx >= slots.length) return;
    const p = this.picked;
    if (p && p.area === area && p.idx === idx) { // 再点一次：取消选中
      this.picked = null;
      this._applyPickedHighlight();
      return;
    }
    if (!p) { // 第一次点击：记下起点
      this.picked = { area, idx };
      this._applyPickedHighlight();
      return;
    }
    // 第二次点击：两格内容互换（可跨容器：快捷栏 ↔ 背包 ↔ 渔网）
    const from = this._areaSlots(p.area);
    if (!from) { this.picked = null; this._applyPickedHighlight(); return; }
    const a = from[p.idx];
    const b = slots[idx];
    from[p.idx] = b;
    slots[idx] = a;
    this.picked = null;
    // 主手（当前选中的快捷栏格）内容被换掉时，自动装备/卸下工具
    const mainTouched =
      (p.area === 'hotbar' && p.idx === this.activeSlot) ||
      (area === 'hotbar' && idx === this.activeSlot);
    if (mainTouched) this.syncMainHand();
    this.refreshCounts();
    if (area === 'net' || p.area === 'net') {
      if (this.openPanel === 'net') this.renderNet();
    }
  }

  // 让"主手"与当前选中快捷栏格的内容保持一致：
  // 格内是工具 → 装备；是空/普通物品 → 卸下。
  syncMainHand() {
    const s = this.inv.hotbar[this.activeSlot];
    const id = s && ITEMS[s.id]?.category === "tool" ? s.id : null;
    if (id === this.game.equipped) return;
    this.game._equip(id);
  }

  refreshCounts() {
    this.renderHotbar();
    this.renderBackpack();
    this.renderRecipes();
  }

  // 选中快捷栏格：格内是工具则装备，切到其他格（空/非工具）则卸下。
  // 任意面板（含 Esc 暂停设置）打开时都不允许切换，避免误触改变选中物品。
  selectSlot(i) {
    if (this.openPanel) return;
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.activeSlot = i;
    this.syncMainHand(); // 格内是工具则装备，空/普通物品则卸下
    this.renderHotbar();
  }

  // 交互提示：显示一段时间后自动消失（约 3 秒）。
  // 相同文本不会每帧续期；文本变化或 force=true 时重新计时。
  setPrompt(text, force = false) {
    if (!text) {
      this.elPrompt.style.display = "none";
      this._promptText = '';
      return;
    }
    const now = performance.now();
    if (force || text !== this._promptText) {
      this._promptText = text;
      this._promptUntil = now + 3000;
    }
    if (now < this._promptUntil) {
      this.elPrompt.style.display = "block";
      this.elPrompt.textContent = text;
    } else {
      this.elPrompt.style.display = "none";
    }
  }

  setEquipped(id) {
    clearTimeout(this._equippedTimer);
    if (!id) { this.elEquipped.style.display = "none"; return; }
    const def = ITEMS[id];
    const hint = (id === 'hook_lock' || id === 'fishing_rod') ? '左键蓄力抛出'
      : (id === 'build_hammer') ? '合成菜单选择建筑后放置'
        : '左键 使用';
    this.elEquipped.style.display = "block";
    // 装备提示只显示文字，避免图片以原始尺寸撑大遮挡游玩画面
    this.elEquipped.innerHTML =
      `<span class="key">[已装备]</span>${def.name}　<span style="opacity:.6">${hint}</span>`;
    // 提示显示一段时间后自动消失
    this._equippedTimer = setTimeout(() => { this.elEquipped.style.display = "none"; }, 1000);
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
    this.picked = null; // 新面板打开时清空格子选中态
    if (which === 'crafting') {
      this.game.cancelBuild(); // 重新打开合成菜单时退出建造模式（幽灵格隐藏）
      this.elCraft.style.display = 'block';
      this.renderRecipes();
    } else if (which === 'sail') {
      this.game.cancelBuild(); // 打开船帆面板时同时退出建造模式
      this.renderSail();
      this.elSail.style.display = 'block';
    } else if (which === 'rescue') {
      this.renderRescue();
      this.elRescue.style.display = 'block';
    } else if (which === 'net') {
      this.game.cancelBuild(); // 打开渔网面板时同时退出建造模式
      this.renderNet();
      this.elNet.style.display = 'block';
      // 渔网面板与背包并排打开，方便直接把物品取到背包
      this.elNet.classList.add('with-backpack');
      this.elBackpack.classList.add('with-net');
      this.elBackpack.style.display = 'block';
      this.renderBackpack();
    } else if (which === 'settings') {
      this.renderSettings();
      this.elSettings.style.display = 'block';
      this.game._settingsOpenedAt = performance.now(); // 供 Esc 去重
      this.game.setPaused(true); // 打开设置即暂停游戏
    } else {
      this.elBackpack.style.display = 'block';
      this.renderBackpack();
    }
    this.openPanel = which;
    document.exitPointerLock?.(); // 显示鼠标
  }

  _closePanels() {
    const wasSettings = this.openPanel === 'settings';
    this.elCraft.style.display = 'none';
    this.elBackpack.style.display = 'none';
    this.elBackpack.classList.remove('with-net');
    if (this.elSail) this.elSail.style.display = 'none';
    if (this.elRescue) this.elRescue.style.display = 'none';
    if (this.elSettings) this.elSettings.style.display = 'none';
    if (this.elNet) {
      this.elNet.style.display = 'none';
      this.elNet.classList.remove('with-backpack');
    }
    this.currentNet = null;
    this.picked = null;
    this.openPanel = null;
    if (wasSettings) this.game.setPaused(false); // 关闭设置即恢复游戏
    this.game.player.requestLock(); // 全部关闭后重新锁定指针
  }

  // 供 Game 在 Esc / 代码中关闭面板
  closePanels() {
    if (this.openPanel) this._closePanels();
  }

  toggleCrafting() { this._openPanel('crafting'); }
  // 渔网面板打开时背包是"并排"显示的，此时按 B 收起的应是整个组合面板
  toggleBackpack() {
    if (this.openPanel === 'net') { this._closePanels(); return; }
    this._openPanel('backpack');
  }
  toggleSailPanel() { this._openPanel('sail'); }

  // 暂停并打开设置面板（Esc 触发）
  openSettings() { this._openPanel('settings'); }

  // 用当前音频设置刷新面板上的开关与音量
  renderSettings() {
    this.elSettings.querySelectorAll(".setting-row").forEach((row) => {
      const s = this.game.audio.getChannel(row.dataset.ch);
      row.querySelector(".s-toggle").checked = s.enabled;
      row.querySelector(".s-vol").value = Math.round(s.volume * 100);
      this._syncSettingRow(row);
    });
  }

  _syncSettingRow(row) {
    const on = row.querySelector(".s-toggle").checked;
    const pct = Math.round(+row.querySelector(".s-vol").value);
    row.querySelector(".s-val").textContent = `${pct}%`;
    row.classList.toggle("off", !on);
  }

  // 保底机制：离木筏过远时由 Game 调用，弹出"是否传送回木筏"确认
  openRescuePanel() {
    this._openPanel('rescue');
  }

  renderRescue() {
    if (!this.elRescueInfo) return;
    const d = this.game.raftDistance();
    this.elRescueInfo.innerHTML =
      `你已离开木筏 <b>${d.toFixed(0)}</b> 米，继续游可能会彻底迷失。<br/>` +
      `是否立即传送回木筏？`;
  }

  // 打开/切换渔网面板：同一个网再右键则关闭，换一个网则直接切换内容
  toggleNetPanel(net) {
    if (this.openPanel === 'net') {
      if (this.currentNet === net) { this._closePanels(); return; }
      this.currentNet = net;
      this.picked = null; // 换了一张网：清空上一张网的选中格
      this.renderNet();
      return;
    }
    this.currentNet = net;
    this._openPanel('net');
  }

  // 渲染渔网储物格：与背包一致的 4x4 格子与堆叠上限。
  // 点击 = 选中/与另一格交换（可与背包、快捷栏互换）；双击 = 直接取出到背包。
  renderNet() {
    const net = this.currentNet;
    if (!net || !this.elNetGrid) return;
    const used = net.storage.filter(Boolean).length;
    const total = net.storage.reduce((a, s) => a + (s ? s.n : 0), 0);
    if (this.elNetInfo) {
      this.elNetInfo.innerHTML =
        `储物 ${used}/${PACK_SIZE} 格（共 ${total} 件）<br/>` +
        `点两格交换物品，双击取出到背包`;
    }
    let cells = "";
    for (let i = 0; i < PACK_SIZE; i++) {
      cells += this.cellHTML(net.storage[i], i, { cls: "cell", picked: this._isPicked('net', i) });
    }
    this.elNetGrid.innerHTML = cells;
    this.elNetGrid.querySelectorAll(".cell").forEach((el) => {
      const idx = +el.dataset.idx;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.pickCell('net', idx);
      });
      el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        this.game.takeNetItem(net, idx);
      });
    });
  }

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

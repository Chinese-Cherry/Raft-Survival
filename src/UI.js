import { ITEMS } from "./Items.js";

// HUD/UI 管理：快捷栏（资源）、背包面板（全部物品）、交互提示、合成面板、指针锁定遮罩。
export class UI {
  constructor(inventory, crafting, game) {
    this.inv = inventory;
    this.crafting = crafting;
    this.game = game;

    this.elPrompt = document.getElementById("prompt");
    this.elCraft = document.getElementById("crafting");
    this.elRecipes = document.getElementById("recipe-list");
    this.elBackpack = document.getElementById("backpack");
    this.elBackpackGrid = document.getElementById("backpack-grid");
    this.elEquipped = document.getElementById("equipped");
    this.elOverlay = document.getElementById("overlay");

    this.elOverlay.addEventListener("click", () => {
      game.player.requestLock();
      this.elOverlay.style.display = "none";
    });
    document.addEventListener("click", () => {
      game.player.requestLock();
    });

    document.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") this.toggleCrafting();
      if (e.code === "KeyB") this.toggleBackpack();
    });

    this.renderRecipes();
    this.renderBackpack();
  }

  // 背包面板：显示所有拥有的物品（资源 + 道具），4 列网格
  renderBackpack() {
    const entries = this.inv.entries();
    if (entries.length === 0) {
      this.elBackpackGrid.innerHTML =
        '<div class="empty-hint">背包是空的，去海里捞点东西吧</div>';
      return;
    }
    this.elBackpackGrid.innerHTML = entries
      .map(
        ({ id, n, def }) => `
      <div class="cell" title="${def.name}">
        <div class="ico">${def.icon}</div>
        <div class="nm">${def.name}</div>
        <div class="cnt">${n}</div>
      </div>`,
      )
      .join("");
  }

  refreshCounts() {
    this.renderBackpack();
    this.renderRecipes();
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
    this.elEquipped.style.display = "block";
    this.elEquipped.innerHTML =
      `<span class="key">[已装备]</span>${def.icon} ${def.name}　<span style="opacity:.6">F 使用</span>`;
  }

  toggleCrafting() {
    const show = this.elCraft.style.display !== "block";
    this.elCraft.style.display = show ? "block" : "none";
    if (show) this.renderRecipes();
  }

  toggleBackpack() {
    const show = this.elBackpack.style.display !== "block";
    this.elBackpack.style.display = show ? "block" : "none";
    if (show) this.renderBackpack();
  }

  renderRecipes() {
    this.elRecipes.innerHTML = this.crafting.recipes
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
        this.crafting.craft(el.dataset.id);
        this.refreshCounts();
      });
    });
  }
}

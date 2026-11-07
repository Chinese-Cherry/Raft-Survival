// 音频管理：
//  - 四个通道：背景音乐 / 环境音 / 音效 / 界面音，均有开关与音量设置（持久化）。
//  - 目前只有背景音乐有音频文件（music/backboard-music.mp3）并实际播放；
//    其余通道暂不播放声音，仅保存设置，等后续提供音频文件后填入 SOURCES 即可。
//  - 暂停游戏时停止所有音乐，恢复时继续。

const STORAGE_KEY = 'raft_audio_settings';

// 各通道的音频文件：为 null 表示暂未提供，只保留设置、不播放
const SOURCES = {
  bgm: 'music/backboard-music.mp3',
  ambient: 'music/大海的声音.mp3', // 环境音：海浪声，循环播放
  sfx: null,     // 后续提供音效文件后填入
  ui: null,      // 后续提供界面音效文件后填入
};

// 循环播放的通道（背景音乐、环境音）
const LOOPING = ['bgm', 'ambient'];

const DEFAULT_SETTINGS = {
  bgm: { enabled: true, volume: 0.45 },
  ambient: { enabled: true, volume: 0.30 },
  sfx: { enabled: true, volume: 0.70 },
  ui: { enabled: true, volume: 0.50 },
};

export class AudioManager {
  constructor() {
    this.settings = this._load();
    this.unlocked = false;
    this.paused = false;

    // 只为已提供音频文件的通道创建播放器
    this.els = {};
    for (const [ch, src] of Object.entries(SOURCES)) {
      if (!src) continue;
      const a = new Audio(src);
      a.loop = LOOPING.includes(ch);
      a.preload = 'auto';
      a.volume = this._vol(ch);
      this.els[ch] = a;
    }
    this.music = this.els.bgm; // 背景音乐（唯一当前会发声的通道）
  }

  // —— 设置读写（localStorage 持久化）——
  _load() {
    const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        for (const ch of Object.keys(base)) {
          if (!saved[ch]) continue;
          if (typeof saved[ch].enabled === 'boolean') base[ch].enabled = saved[ch].enabled;
          const v = Number(saved[ch].volume);
          if (Number.isFinite(v)) base[ch].volume = Math.max(0, Math.min(1, v));
        }
      }
    } catch (_) { /* 读取失败时使用默认值 */ }
    return base;
  }

  _save() {
    const out = {};
    for (const [ch, s] of Object.entries(this.settings)) {
      out[ch] = { enabled: s.enabled, volume: s.volume };
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch (_) { /* 忽略 */ }
  }

  getChannel(ch) { return this.settings[ch]; }

  _vol(ch) {
    const s = this.settings[ch];
    return s && s.enabled ? s.volume : 0;
  }

  // —— 进入游戏时尝试立即播放（被自动播放策略拦截时，unlock() 会再启动）——
  tryAutoplay() {
    this._play('bgm', true);
    this._play('ambient', true);
  }

  // —— 用户手势后解锁音频 ——
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this._play('bgm');
    this._play('ambient');
  }

  // 播放某通道（无音频文件或已暂停时静默跳过）
  play(ch) { this._play(ch); }

  _play(ch, force = false) {
    const a = this.els[ch];
    if (!a) return; // 该通道暂无音频文件
    if (!force && !this.unlocked) return;
    if (this.paused || this._vol(ch) <= 0) return;
    a.volume = this._vol(ch);
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  // 暂停/恢复游戏时停止/继续所有循环音乐
  setPaused(v) {
    this.paused = !!v;
    for (const ch of LOOPING) {
      const a = this.els[ch];
      if (!a) continue;
      if (this.paused) a.pause();
      else this._play(ch);
    }
  }

  // —— 开关 / 音量 ——
  setEnabled(ch, on) {
    if (!this.settings[ch]) return;
    this.settings[ch].enabled = !!on;
    this._apply(ch);
    this._save();
  }

  setVolume(ch, v) {
    if (!this.settings[ch]) return;
    this.settings[ch].volume = Math.max(0, Math.min(1, Number(v) || 0));
    this._apply(ch);
    this._save();
  }

  _apply(ch) {
    const a = this.els[ch];
    if (!a) return; // 无音频文件：只保存设置
    a.volume = this._vol(ch);
    if (this._vol(ch) > 0) this._play(ch);
    else a.pause();
  }
}

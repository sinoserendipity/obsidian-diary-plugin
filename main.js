const {
  DropdownComponent,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  debounce,
  normalizePath,
} = require("obsidian");

const VIEW_TYPE = "diary-sidebar-view";

const DEFAULT_SETTINGS = {
  templatePath: "Templates/Daily-Journal-A-Jing.md",
  diaryRoot: "日记",
  hasYearFolder: true,
  hasMonthFolder: true,
  monthFolderFormat: "M月",
  fileNameFormat: "M月D日星期W",
  showTagBrowser: true,
  showOnThisDay: true,
  showYearlyStats: true,
  heatmapColor: "accent",
  barColor: "purple",
};

const COLOR_OPTIONS = {
  accent: { label: "主题强调色", value: "var(--interactive-accent)" },
  green: { label: "绿色", value: "var(--color-green)" },
  purple: { label: "浅紫色", value: "color-mix(in srgb, var(--color-purple) 54%, var(--background-primary))" },
  blue: { label: "蓝色", value: "color-mix(in srgb, var(--color-blue) 58%, var(--background-primary))" },
  cyan: { label: "青色", value: "color-mix(in srgb, var(--color-cyan) 58%, var(--background-primary))" },
  orange: { label: "暖橙色", value: "color-mix(in srgb, var(--color-orange) 58%, var(--background-primary))" },
};

const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

function div(parent, className, text) {
  const el = parent.createDiv({ cls: className });
  if (text !== undefined) el.setText(text);
  return el;
}

function span(parent, className, text) {
  const el = parent.createSpan({ cls: className });
  if (text !== undefined) el.setText(text);
  return el;
}

function button(parent, className, text) {
  const el = parent.createEl("button", { cls: className, text });
  el.type = "button";
  return el;
}

function select(parent, className) {
  return parent.createEl("select", { cls: className });
}

function option(parent, value, text, selected = false) {
  const el = parent.createEl("option", { text });
  el.value = value;
  el.selected = selected;
  return el;
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mondayWeekIndex(date) {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

function normalizeTags(tags) {
  if (!tags) return [];
  const values = Array.isArray(tags) ? tags : String(tags).split(/[,\s]+/);
  return values
    .map((tag) => String(tag).trim().replace(/^#/, ""))
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDatePattern(pattern, date) {
  const year = String(date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const week = WEEKDAY_SHORT[mondayWeekIndex(date)];
  return pattern
    .replace(/YYYY/g, year)
    .replace(/MM/g, String(month).padStart(2, "0"))
    .replace(/DD/g, String(day).padStart(2, "0"))
    .replace(/M/g, String(month))
    .replace(/D/g, String(day))
    .replace(/W/g, week);
}

function patternToRegex(pattern) {
  const tokenRegex = /YYYY|MM|DD|M|D|W/g;
  let regex = "^";
  let cursor = 0;
  const groups = [];
  let match;

  while ((match = tokenRegex.exec(pattern))) {
    regex += escapeRegExp(pattern.slice(cursor, match.index));
    const token = match[0];
    groups.push(token);

    if (token === "YYYY") regex += "(\\d{4})";
    if (token === "MM" || token === "M") regex += "(\\d{1,2})";
    if (token === "DD" || token === "D") regex += "(\\d{1,2})";
    if (token === "W") regex += "([一二三四五六日])";

    cursor = match.index + token.length;
  }

  regex += escapeRegExp(pattern.slice(cursor));
  regex += "(?:_(\\d+))?$";
  return { regex: new RegExp(regex), groups };
}

class MonthCalendar {
  constructor(container, onDayClick) {
    this.container = container;
    this.onDayClick = onDayClick;
  }

  render(monthStats, today) {
    this.container.empty();
    const { year, month, writtenDays } = monthStats;
    const todayNumber =
      today.getFullYear() === year && today.getMonth() + 1 === month ? today.getDate() : -1;

    const header = div(this.container, "diary-cal-header");
    for (const label of WEEKDAY_SHORT) div(header, "diary-cal-weekday", label);

    const grid = div(this.container, "diary-cal-grid");
    const firstDayOffset = mondayWeekIndex(new Date(year, month - 1, 1));
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < firstDayOffset; i++) div(grid, "diary-cal-day diary-cal-empty");

    for (let day = 1; day <= daysInMonth; day++) {
      const hasEntry = writtenDays.has(day);
      const classes = [
        "diary-cal-day",
        hasEntry ? "diary-cal-has-entry" : "diary-cal-no-entry",
        day === todayNumber ? "diary-cal-today" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const dayEl = div(grid, classes, String(day));
      dayEl.title = `${month}月${day}日 · ${hasEntry ? "有日记" : "无日记"}`;
      dayEl.addEventListener("click", () => this.onDayClick(year, month, day, hasEntry));
    }

    const percent = daysInMonth > 0 ? Math.round((writtenDays.size / daysInMonth) * 100) : 0;
    div(this.container, "diary-cal-footer", `已写 ${writtenDays.size}/${daysInMonth} 天 (${percent}%)`);
  }
}

class ConfirmModal extends Modal {
  constructor(app, heading, message, onConfirm) {
    super(app);
    this.heading = heading;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.heading });
    contentEl.createEl("p", { text: this.message });

    const buttonRow = contentEl.createDiv({ cls: "diary-confirm-buttons" });
    const cancelBtn = buttonRow.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { text: "创建", cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class DiaryStatsService {
  constructor(app, plugin, settings) {
    this.app = app;
    this.plugin = plugin;
    this.settings = settings;
    this.cache = null;
    this.yearStatsCache = new Map();
  }

  updateSettings(settings) {
    this.settings = settings;
    this.cache = null;
    this.yearStatsCache.clear();
  }

  settingsHash() {
    const { diaryRoot, hasYearFolder, hasMonthFolder, monthFolderFormat, fileNameFormat } = this.settings;
    return `${diaryRoot}|${hasYearFolder}|${hasMonthFolder}|${monthFolderFormat}|${fileNameFormat}`;
  }

  getCache() {
    return this.cache;
  }

  buildDirPath(date) {
    let path = this.settings.diaryRoot.trim() || DEFAULT_SETTINGS.diaryRoot;
    if (this.settings.hasYearFolder) path += `/${date.getFullYear()}`;
    if (this.settings.hasMonthFolder) {
      path += `/${formatDatePattern(this.settings.monthFolderFormat || "M月", date)}`;
    }
    return normalizePath(path);
  }

  buildDiaryPath(date, suffixNumber) {
    const fileName = formatDatePattern(this.settings.fileNameFormat || DEFAULT_SETTINGS.fileNameFormat, date);
    const suffix = suffixNumber ? `_${suffixNumber}` : "";
    return normalizePath(`${this.buildDirPath(date)}/${fileName}${suffix}.md`);
  }

  parseDiaryPath(file) {
    if (!file.path.startsWith(`${this.settings.diaryRoot}/`)) return null;

    const parts = file.path.split("/");
    let yearFromFolder = null;
    if (this.settings.hasYearFolder && parts.length >= 2) {
      const parsedYear = Number(parts[1]);
      if (!Number.isNaN(parsedYear)) yearFromFolder = parsedYear;
    }

    const configured = this.parseWithConfiguredPattern(file.basename, yearFromFolder);
    if (configured) return configured;

    const chinese = file.basename.match(/^(\d{1,2})月(\d{1,2})日(?:星期[一二三四五六日])?(?:_(\d+))?$/);
    if (chinese) {
      const fallbackYear = yearFromFolder || new Date().getFullYear();
      return {
        year: fallbackYear,
        month: Number(chinese[1]),
        day: Number(chinese[2]),
        suffix: chinese[3],
      };
    }

    const dash = file.basename.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:_(\d+))?$/);
    if (dash) {
      return { year: Number(dash[1]), month: Number(dash[2]), day: Number(dash[3]), suffix: dash[4] };
    }

    const compact = file.basename.match(/^(\d{4})(\d{2})(\d{2})(?:_(\d+))?$/);
    if (compact) {
      return {
        year: Number(compact[1]),
        month: Number(compact[2]),
        day: Number(compact[3]),
        suffix: compact[4],
      };
    }

    return null;
  }

  parseWithConfiguredPattern(basename, yearFromFolder) {
    const { regex, groups } = patternToRegex(this.settings.fileNameFormat || DEFAULT_SETTINGS.fileNameFormat);
    const match = basename.match(regex);
    if (!match) return null;

    let year = yearFromFolder;
    let month = null;
    let day = null;
    let groupIndex = 1;
    for (const token of groups) {
      const value = match[groupIndex++];
      if (token === "YYYY") year = Number(value);
      if (token === "MM" || token === "M") month = Number(value);
      if (token === "DD" || token === "D") day = Number(value);
    }

    if (!year || !month || !day) return null;
    return { year, month, day, suffix: match[groupIndex] };
  }

  async ensureFolder(path) {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async saveCache() {
    if (!this.cache) return;
    try {
      const data = (await this.plugin.loadData()) || {};
      await this.plugin.saveData({
        ...data,
        settings: this.plugin.settings,
        vaultStatsCache: {
          totalEntries: this.cache.totalEntries,
          entriesByDate: Array.from(this.cache.entriesByDate.entries()),
          years: this.cache.years,
          lastScanned: this.cache.lastScanned,
          settingsHash: this.settingsHash(),
        },
      });
    } catch (error) {
      console.warn("DiaryPlugin: 缓存保存失败", error);
    }
  }

  async loadCache() {
    try {
      const data = await this.plugin.loadData();
      const savedCache = data?.vaultStatsCache;
      if (!savedCache || savedCache.settingsHash !== this.settingsHash()) return false;

      this.cache = {
        totalEntries: savedCache.totalEntries || 0,
        entriesByDate: new Map(savedCache.entriesByDate || []),
        years: savedCache.years || [],
        lastScanned: savedCache.lastScanned || 0,
      };
      this.yearStatsCache.clear();
      return true;
    } catch (error) {
      console.warn("DiaryPlugin: 缓存读取失败", error);
      return false;
    }
  }

  async recompute() {
    const entriesByDate = new Map();
    const years = new Set();
    let totalEntries = 0;
    const root = `${this.settings.diaryRoot}/`;
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(root) && file.extension === "md");

    for (const file of files) {
      const parsed = this.parseDiaryPath(file);
      if (!parsed) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      const entry = {
        path: file.path,
        year: parsed.year,
        month: parsed.month,
        day: parsed.day,
        suffix: parsed.suffix,
        frontmatter: {
          ...frontmatter,
          tags: normalizeTags(frontmatter.tags),
        },
      };
      const key = dateKey(parsed.year, parsed.month, parsed.day);
      if (!entriesByDate.has(key)) entriesByDate.set(key, []);
      entriesByDate.get(key).push(entry);
      years.add(parsed.year);
      totalEntries++;
    }

    this.cache = {
      totalEntries,
      entriesByDate,
      years: Array.from(years).sort((a, b) => b - a),
      lastScanned: Date.now(),
    };
    this.yearStatsCache.clear();
    return this.cache;
  }

  getMonthStats(year, month) {
    const writtenDays = new Set();
    const entries = [];
    if (!this.cache) return { year, month, writtenDays, entries };

    for (const [key, dayEntries] of this.cache.entriesByDate) {
      const [entryYear, entryMonth] = key.split("-").map(Number);
      if (entryYear === year && entryMonth === month) {
        for (const entry of dayEntries) {
          writtenDays.add(entry.day);
          entries.push(entry);
        }
      }
    }
    return { year, month, writtenDays, entries };
  }

  getYearStats(year) {
    if (this.yearStatsCache.has(year)) return this.yearStatsCache.get(year);

    const monthCounts = new Array(12).fill(0);
    const tagCounts = {};
    const writtenDates = new Set();
    let totalEntries = 0;

    if (this.cache) {
      for (const [key, entries] of this.cache.entriesByDate) {
        const [entryYear, month] = key.split("-").map(Number);
        if (entryYear !== year) continue;

        writtenDates.add(key);
        monthCounts[month - 1] += entries.length;
        totalEntries += entries.length;
        for (const entry of entries) {
          for (const tag of normalizeTags(entry.frontmatter.tags)) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }
      }
    }

    const stats = {
      year,
      totalEntries,
      longestStreak: this.calcLongestStreak(year, writtenDates),
      currentStreak: this.calcCurrentStreak(writtenDates),
      monthCounts,
      tagCounts,
      writtenDates,
    };
    this.yearStatsCache.set(year, stats);
    return stats;
  }

  calcCurrentStreak(writtenDates) {
    let streak = 0;
    const cursor = new Date();
    const today = dateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    if (!writtenDates.has(today)) cursor.setDate(cursor.getDate() - 1);

    while (true) {
      const key = dateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (!writtenDates.has(key)) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  calcLongestStreak(year, writtenDates) {
    let longest = 0;
    let current = 0;
    const days = this.isLeapYear(year) ? 366 : 365;
    const start = new Date(year, 0, 1);

    for (let i = 0; i < days; i++) {
      const cursor = new Date(start);
      cursor.setDate(start.getDate() + i);
      const key = dateKey(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (writtenDates.has(key)) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }
    return longest;
  }

  isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  getWeekMonthStats() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - mondayWeekIndex(today));
    weekStart.setHours(0, 0, 0, 0);

    let weekDays = 0;
    let monthDays = 0;
    let monthTotal = 0;
    if (!this.cache) return { weekDays, monthDays, monthTotal };

    for (const [key, entries] of this.cache.entriesByDate) {
      const [entryYear, entryMonth, day] = key.split("-").map(Number);
      if (entryYear !== year || entryMonth !== month) continue;

      monthDays++;
      monthTotal += entries.length;
      const entryDate = new Date(entryYear, entryMonth - 1, day);
      if (entryDate >= weekStart && entryDate <= today) weekDays++;
    }
    return { weekDays, monthDays, monthTotal };
  }

  todayWritten() {
    if (!this.cache) return false;
    const today = new Date();
    return this.cache.entriesByDate.has(dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate()));
  }

  async getBodyInfo(file) {
    try {
      const raw = await this.app.vault.read(file);
      const body = raw
        .replace(/^---[\s\S]*?---\n?/, "")
        .replace(/^(>.*\n?)+/gm, "")
        .trim();
      const preview = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line !== "---" && !/^#{1,6}\s/.test(line) && !/^#[^\s]/.test(line) && !/^<%/.test(line))
        .filter((line) => line !== "-")
        .slice(0, 2)
        .join(" ")
        .slice(0, 70);
      const chineseCount = (body.match(/[\u4e00-\u9fa5]/g) || []).length;
      const wordCount = chineseCount + ((body.replace(/[\u4e00-\u9fa5]/g, "").match(/\S+/g) || []).length);
      return { preview, wordCount };
    } catch {
      return { preview: "", wordCount: 0 };
    }
  }

  async hydrateEntries(entries) {
    await Promise.all(
      entries.map(async (entry) => {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (file instanceof TFile) {
          const body = await this.getBodyInfo(file);
          entry.preview = body.preview;
          entry.wordCount = body.wordCount;
        }
      })
    );
    return entries;
  }

  async getOnThisDay(limit) {
    if (!this.cache) return [];
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const result = [];

    for (let i = 1; i <= limit; i++) {
      const year = today.getFullYear() - i;
      const entries = this.cache.entriesByDate.get(dateKey(year, month, day));
      if (entries?.length) {
        await this.hydrateEntries(entries);
        result.push({ year, entries });
      }
    }
    return result;
  }

  getAllTags() {
    const counts = {};
    if (!this.cache) return [];

    for (const entries of this.cache.entriesByDate.values()) {
      for (const entry of entries) {
        for (const tag of normalizeTags(entry.frontmatter.tags)) {
          counts[tag] = (counts[tag] || 0) + 1;
        }
      }
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }

  async getEntriesByTags(tags) {
    if (!this.cache || tags.length === 0) return [];
    const result = [];
    const keys = Array.from(this.cache.entriesByDate.keys()).sort((a, b) => b.localeCompare(a));

    for (const key of keys) {
      for (const entry of this.cache.entriesByDate.get(key) || []) {
        const entryTags = normalizeTags(entry.frontmatter.tags);
        if (tags.every((tag) => entryTags.includes(tag))) result.push(entry);
      }
    }
    return this.hydrateEntries(result);
  }
}

class DiarySidebarView extends ItemView {
  constructor(leaf, statsService, plugin) {
    super(leaf);
    this.statsService = statsService;
    this.plugin = plugin;
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1;
    this.onThisDayOpen = true;
    this.selectedYear = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "日记管理";
  }

  getIcon() {
    return "book-open";
  }

  async onOpen() {
    await this.refresh();
  }

  async renderToContainer(showLoading) {
    const container = this.containerEl.children[1];
    const scrollTop = container.scrollTop;
    const settings = this.plugin.settings;

    if (showLoading) {
      container.empty();
      container.className = "diary-sidebar";
      div(container, "diary-loading", "扫描中...");
    }

    const fragment = document.createElement("div");
    fragment.className = "diary-sidebar";
    this.renderOverview(fragment);
    this.renderCalendar(fragment);

    if (settings.showTagBrowser) await this.renderTagBrowser(fragment);
    if (settings.showOnThisDay) await this.renderOnThisDay(fragment);
    if (settings.showYearlyStats) this.renderYearlyStats(fragment);

    container.className = "diary-sidebar";
    this.applyThemeVariables(container);
    container.replaceChildren(...Array.from(fragment.childNodes));
    container.scrollTop = scrollTop;
  }

  applyThemeVariables(element) {
    const heatmapColor = COLOR_OPTIONS[this.plugin.settings.heatmapColor]?.value || COLOR_OPTIONS.accent.value;
    const barColor = COLOR_OPTIONS[this.plugin.settings.barColor]?.value || COLOR_OPTIONS.purple.value;
    element.style.setProperty("--diary-heatmap-color", heatmapColor);
    element.style.setProperty("--diary-bar-color", barColor);
  }

  async renderFromCache() {
    await this.renderToContainer(false);
  }

  async refresh() {
    await this.renderToContainer(true);
  }

  renderOverview(parent) {
    const panel = div(parent, "diary-panel diary-panel-a");
    this.fillOverview(panel);
  }

  fillOverview(panel) {
    const cache = this.statsService.getCache();
    const todayWritten = this.statsService.todayWritten();
    const { weekDays, monthDays, monthTotal } = this.statsService.getWeekMonthStats();

    const status = div(panel, "diary-status-row");
    span(status, "diary-today-icon", todayWritten ? "✓" : "○");
    span(status, "diary-today-label", todayWritten ? "今日已写" : "今日未写");
    span(status, "diary-total", `共 ${cache?.totalEntries || 0} 篇`);

    const currentStreak = this.statsService.getYearStats(new Date().getFullYear()).currentStreak;
    if (currentStreak > 0) {
      div(panel, "diary-streak-banner", `已连续写了 ${currentStreak} 天，继续保持`);
    } else if (!todayWritten) {
      div(panel, "diary-streak-banner diary-streak-miss", "今天还没写，来记录一下吧");
    }

    const summary = div(panel, "diary-summary-row");
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    div(summary, "diary-summary-item", `本周 ${weekDays} 天`);
    div(summary, "diary-summary-item", `本月 ${monthDays}/${daysInMonth} 天`);
    div(summary, "diary-summary-item", `本月 ${monthTotal} 篇`);

    const actions = div(panel, "diary-actions");
    button(actions, "diary-btn diary-btn-primary", "✎ 写今天").addEventListener("click", () => {
      this.app.commands.executeCommandById("diary-plugin:write-today");
    });
    button(actions, "diary-btn", "⌖ 跳今天").addEventListener("click", () => {
      this.app.commands.executeCommandById("diary-plugin:jump-today");
    });
  }

  renderCalendar(parent) {
    const panel = div(parent, "diary-panel diary-panel-b");
    const cache = this.statsService.getCache();
    const years = cache?.years?.length ? cache.years : [new Date().getFullYear()];
    const controls = div(panel, "diary-cal-controls");
    const prev = button(controls, "diary-cal-arrow", "‹");
    prev.title = "上个月";
    const yearSelect = select(controls, "diary-select");
    for (const year of years) option(yearSelect, String(year), String(year), year === this.currentYear);
    const monthSelect = select(controls, "diary-select");
    for (let month = 1; month <= 12; month++) option(monthSelect, String(month), `${month}月`, month === this.currentMonth);
    const next = button(controls, "diary-cal-arrow", "›");
    next.title = "下个月";
    const todayBtn = button(controls, "diary-cal-arrow diary-cal-today-btn", "今天");
    todayBtn.title = "回到今天";

    const calendar = div(panel, "diary-cal-container");

    const syncSelects = () => {
      if (!yearSelect.querySelector(`option[value="${this.currentYear}"]`)) {
        option(yearSelect, String(this.currentYear), String(this.currentYear));
      }
      yearSelect.value = String(this.currentYear);
      monthSelect.value = String(this.currentMonth);
    };

    const moveMonth = (delta) => {
      this.currentMonth += delta;
      if (this.currentMonth > 12) {
        this.currentMonth = 1;
        this.currentYear++;
      }
      if (this.currentMonth < 1) {
        this.currentMonth = 12;
        this.currentYear--;
      }
      syncSelects();
      this.updateCalendar(calendar);
    };

    prev.addEventListener("click", () => moveMonth(-1));
    next.addEventListener("click", () => moveMonth(1));
    todayBtn.addEventListener("click", () => {
      const now = new Date();
      this.currentYear = now.getFullYear();
      this.currentMonth = now.getMonth() + 1;
      syncSelects();
      this.updateCalendar(calendar);
    });
    yearSelect.addEventListener("change", () => {
      this.currentYear = Number(yearSelect.value);
      this.updateCalendar(calendar);
    });
    monthSelect.addEventListener("change", () => {
      this.currentMonth = Number(monthSelect.value);
      this.updateCalendar(calendar);
    });
    this.updateCalendar(calendar);
  }

  updateCalendar(container) {
    const stats = this.statsService.getMonthStats(this.currentYear, this.currentMonth);
    new MonthCalendar(container, async (year, month, day, hasEntry) => {
      if (hasEntry) {
        const entries = this.statsService.getCache()?.entriesByDate.get(dateKey(year, month, day)) || [];
        await this.openEntry(entries[0]);
      } else {
        const date = new Date(year, month - 1, day);
        new ConfirmModal(
          this.app,
          "创建新日记",
          `${year} 年 ${month} 月 ${day} 日还没有日记，是否新建一篇？`,
          async () => await this.createDiaryForDate(date)
        ).open();
      }
    }).render(stats, new Date());
  }

  async renderTagBrowser(parent) {
    const panel = div(parent, "diary-panel diary-panel-c");
    const header = div(panel, "diary-panel-c-header");
    div(header, "diary-section-title", "标签浏览");

    const tags = this.statsService.getAllTags();
    if (!tags.length) {
      div(panel, "diary-empty", "暂无标签");
      return;
    }

    const tagSelect = select(header, "diary-select diary-tag-filter");
    option(tagSelect, "", "选择标签...");
    for (const { tag, count } of tags) option(tagSelect, tag, `# ${tag} (${count})`);

    const stats = div(panel, "diary-tagbrowser-stats diary-hidden");
    const timeline = div(panel, "diary-tagbrowser-timeline");
    tagSelect.addEventListener("change", async () => {
      const tag = tagSelect.value;
      timeline.empty();
      stats.empty();
      if (!tag) {
        stats.classList.add("diary-hidden");
        return;
      }
      stats.classList.remove("diary-hidden");
      div(timeline, "diary-empty", "加载中...");
      const entries = await this.statsService.getEntriesByTags([tag]);
      timeline.empty();
      const years = [...new Set(entries.map((entry) => entry.year))];
      stats.setText(`# ${tag} · 共 ${entries.length} 篇 · 跨 ${years.length} 年`);
      if (!entries.length) {
        div(timeline, "diary-empty", "暂无日记");
        return;
      }
      let currentGroup = "";
      for (const entry of entries) {
        const group = `${entry.year}-${entry.month}`;
        if (group !== currentGroup) {
          const separator = div(timeline, "diary-tl-separator");
          div(separator, "diary-tl-sep-line");
          span(separator, "diary-tl-sep-label", `${entry.year} 年 ${entry.month} 月`);
          div(separator, "diary-tl-sep-line");
          currentGroup = group;
        }
        this.renderTagEntry(timeline, entry, tag);
      }
    });
  }

  renderTagEntry(parent, entry, selectedTag) {
    const row = div(parent, "diary-tl-row");
    const left = div(row, "diary-tl-left");
    span(left, "diary-tl-month", `${entry.year}/${entry.month}`);
    span(left, "diary-tl-day", String(entry.day));
    div(left, "diary-tl-dot");
    div(left, "diary-tl-line");

    const card = div(row, "diary-tl-card");
    const top = div(card, "diary-tl-card-top");
    if (entry.wordCount) span(top, "diary-word-count", `${entry.wordCount}字`);
    if (entry.preview) div(card, "diary-tl-preview", entry.preview);

    const tags = normalizeTags(entry.frontmatter.tags)
      .filter((tag) => tag !== selectedTag)
      .slice(0, 3);
    if (tags.length) {
      const tagRow = div(card, "diary-tag-row");
      for (const tag of tags) span(tagRow, "diary-tag", tag);
    }
    card.addEventListener("click", () => this.openEntry(entry));
  }

  async renderOnThisDay(parent) {
    const today = new Date();
    const entries = await this.statsService.getOnThisDay(5);
    if (!entries.length) return;

    const panel = div(parent, "diary-panel diary-panel-e");
    const title = div(panel, "diary-section-title diary-section-toggleable");
    span(title, "", `${today.getMonth() + 1}月${today.getDate()}日的历史`);
    const arrow = span(title, "diary-arrow", this.onThisDayOpen ? "▼" : "▶");
    const content = div(panel, "diary-onthisday-content");
    content.classList.toggle("diary-hidden", !this.onThisDayOpen);
    title.addEventListener("click", () => {
      this.onThisDayOpen = !this.onThisDayOpen;
      content.classList.toggle("diary-hidden", !this.onThisDayOpen);
      arrow.setText(this.onThisDayOpen ? "▼" : "▶");
    });

    for (const { year, entries: yearEntries } of entries) {
      const block = div(content, "diary-otd-block");
      const blockHeader = div(block, "diary-otd-header");
      span(blockHeader, "diary-otd-year", `${today.getFullYear() - year} 年前 · ${year} 年`);
      if (yearEntries.length > 1) span(blockHeader, "diary-otd-count", `${yearEntries.length} 篇`);

      for (const entry of yearEntries) {
        const item = div(block, "diary-otd-item");
        if (entry.preview) div(item, "diary-otd-preview", entry.preview);
        const meta = div(item, "diary-otd-meta");
        if (entry.wordCount) span(meta, "diary-word-count", `${entry.wordCount}字`);
        const tags = normalizeTags(entry.frontmatter.tags);
        if (tags.length) {
          const tagRow = div(meta, "diary-tag-row");
          for (const tag of tags.slice(0, 3)) span(tagRow, "diary-tag", tag);
        }
        item.addEventListener("click", () => this.openEntry(entry));
      }
    }
  }

  renderYearlyStats(parent) {
    const cache = this.statsService.getCache();
    if (!cache?.years?.length) return;

    const years = cache.years;
    if (!this.selectedYear || !years.includes(this.selectedYear)) {
      this.selectedYear = years[0];
    }

    const panel = div(parent, "diary-panel diary-panel-d");
    const header = div(panel, "diary-yearly-header");

    const left = div(header, "diary-yearly-left");
    const titleEl = span(left, "diary-section-title diary-yearly-title-text", "");
    const totalEl = span(left, "diary-year-total", "");
    span(left, "diary-year-streak", "");

    const dropdownEl = div(header, "diary-year-dropdown");
    const dropdown = new DropdownComponent(dropdownEl);
    for (const y of years) dropdown.addOption(String(y), `${y} 年`);
    dropdown.setValue(String(this.selectedYear));

    const content = div(panel, "diary-yearly-content");

    const updateHeader = (year) => {
      const stats = this.statsService.getYearStats(year);
      titleEl.setText(`${year} 年写作热力图`);
      totalEl.setText(`${stats.totalEntries} 篇`);
      left.querySelector(".diary-year-streak").setText(`最长连续 ${stats.longestStreak} 天`);
    };

    const renderSelected = () => {
      updateHeader(this.selectedYear);
      content.empty();
      this.renderYearlyContent(content, [this.selectedYear]);
    };

    renderSelected();

    dropdown.onChange((val) => {
      this.selectedYear = Number(val);
      renderSelected();
    });
  }

  renderYearlyContent(parent, years) {
    for (const year of years) {
      const stats = this.statsService.getYearStats(year);
      const section = div(parent, "diary-year-section");
      this.renderHeatmap(section, year, stats.writtenDates);
      this.renderMonthBars(section, stats);
      this.renderTagCloud(section, stats);
    }
  }

  renderHeatmap(parent, year, writtenDates) {
    const wrap = div(parent, "diary-heatmap-wrap");
    const monthsGrid = div(wrap, "diary-heatmap-months-grid");

    const today = new Date();
    const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

    for (let m = 1; m <= 12; m++) {
      const block = div(monthsGrid, "diary-hm-month-block");
      div(block, "diary-hm-month-label", `${m}月`);
      const grid = div(block, "diary-hm-month-grid");

      const start = new Date(year, m - 1, 1);
      const daysInMonth = new Date(year, m, 0).getDate();
      const offset = mondayWeekIndex(start);

      for (let i = 0; i < offset; i++) div(grid, "diary-hm-cell diary-hm-empty");
      for (let d = 1; d <= daysInMonth; d++) {
        const key = dateKey(year, m, d);
        const written = writtenDates.has(key);
        const isToday = key === todayKey;
        const cell = div(grid, `diary-hm-cell${written ? " diary-hm-written" : ""}${isToday ? " diary-hm-today" : ""}`);
        cell.title = `${m}月${d}日${written ? " 已写" : ""}`;
      }
    }
  }

  renderMonthBars(parent, stats) {
    const bars = div(parent, "diary-month-bars");
    const max = Math.max(...stats.monthCounts, 1);
    stats.monthCounts.forEach((count, index) => {
      const col = div(bars, "diary-bar-col");
      const bar = div(col, "diary-bar");
      bar.style.height = `${Math.round((count / max) * 100)}%`;
      if (count > 0) bar.title = `${index + 1}月: ${count} 篇`;
      div(col, "diary-bar-label", String(index + 1));
    });
  }

  renderTagCloud(parent, stats) {
    const tags = Object.entries(stats.tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    if (!tags.length) return;

    const cloud = div(parent, "diary-tag-cloud");
    for (const [tag, count] of tags) {
      const tagEl = span(cloud, "diary-tag-cloud-item", `${tag} (${count})`);
      tagEl.style.fontSize = `${10 + Math.min(count * 2, 8)}px`;
    }
  }

  async createDiaryForDate(date) {
    let suffix = 0;
    let path = this.statsService.buildDiaryPath(date);
    while (this.app.vault.getAbstractFileByPath(path)) {
      suffix++;
      path = this.statsService.buildDiaryPath(date, suffix);
    }

    await this.statsService.ensureFolder(this.statsService.buildDirPath(date));

    let content = `---\ncreationDate: ${date.toISOString().slice(0, 16)}\n---\n\n`;
    const template = this.app.vault.getAbstractFileByPath(this.plugin.settings.templatePath);
    if (template instanceof TFile) {
      content = (await this.app.vault.read(template))
        .replace(/\{\{date\}\}/g, date.toLocaleDateString("zh-CN"))
        .replace(/\{\{time\}\}/g, date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    }

    const file = await this.app.vault.create(path, content);
    await this.app.workspace.getLeaf().openFile(file);
    await this.plugin.recomputeAndRefresh(false);
  }

  async writeTodayDiary() {
    if (this.statsService.todayWritten()) {
      await this.jumpToTodayDiary();
      return;
    }
    await this.createDiaryForDate(new Date());
  }

  async jumpToTodayDiary() {
    if (!this.statsService.todayWritten()) {
      new Notice("今日暂无日记");
      return;
    }
    const today = new Date();
    const entries =
      this.statsService.getCache()?.entriesByDate.get(dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate())) || [];
    await this.openEntry(entries[0]);
  }

  async openEntry(entry) {
    if (!entry) return;
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (file instanceof TFile) await this.app.workspace.getLeaf().openFile(file);
  }
}

class DiarySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "日记管理 · 设置" });

    const preview = document.createElement("div");

    containerEl.createEl("h3", { text: "模板" });
    new Setting(containerEl)
      .setName("日记模板路径")
      .setDesc("相对于 Vault 根目录的路径，例如：Templates/Daily-Journal-A-Jing.md")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.templatePath)
          .setValue(this.plugin.settings.templatePath)
          .onChange(async (value) => {
            this.plugin.settings.templatePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "目录结构" });
    new Setting(containerEl)
      .setName("日记根目录")
      .setDesc("存放日记的顶层文件夹名称。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.diaryRoot)
          .setValue(this.plugin.settings.diaryRoot)
          .onChange(async (value) => {
            this.plugin.settings.diaryRoot = value.trim() || DEFAULT_SETTINGS.diaryRoot;
            this.updatePreview(preview);
            await this.plugin.saveAndApply();
          })
      );

    new Setting(containerEl)
      .setName("按年份建立子目录")
      .setDesc("例如：日记/2026/")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hasYearFolder).onChange(async (value) => {
          this.plugin.settings.hasYearFolder = value;
          this.updatePreview(preview);
          await this.plugin.saveAndApply();
        })
      );

    new Setting(containerEl)
      .setName("按月份建立子目录")
      .setDesc("例如：日记/2026/6月/")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hasMonthFolder).onChange(async (value) => {
          this.plugin.settings.hasMonthFolder = value;
          this.updatePreview(preview);
          await this.plugin.saveAndApply();
        })
      );

    new Setting(containerEl)
      .setName("月份目录格式")
      .setDesc("M = 月份数字，MM = 两位数月份。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.monthFolderFormat)
          .setValue(this.plugin.settings.monthFolderFormat)
          .onChange(async (value) => {
            this.plugin.settings.monthFolderFormat = value.trim() || DEFAULT_SETTINGS.monthFolderFormat;
            this.updatePreview(preview);
            await this.plugin.saveAndApply();
          })
      );

    containerEl.createEl("h3", { text: "文件名格式" });
    new Setting(containerEl)
      .setName("文件名格式")
      .setDesc("可用变量：YYYY 年，M/MM 月，D/DD 日，W 中文星期。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.fileNameFormat)
          .setValue(this.plugin.settings.fileNameFormat)
          .onChange(async (value) => {
            this.plugin.settings.fileNameFormat = value.trim() || DEFAULT_SETTINGS.fileNameFormat;
            this.updatePreview(preview);
            await this.plugin.saveAndApply();
          })
      );

    containerEl.appendChild(preview);
    this.updatePreview(preview);

    containerEl.createEl("h3", { text: "界面" });
    new Setting(containerEl)
      .setName("显示标签浏览")
      .setDesc("按 frontmatter tags 浏览日记。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showTagBrowser).onChange(async (value) => {
          this.plugin.settings.showTagBrowser = value;
          await this.plugin.saveAndRender();
        })
      );

    new Setting(containerEl)
      .setName("显示历史上的今天")
      .setDesc("显示往年同一天写过的日记。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showOnThisDay).onChange(async (value) => {
          this.plugin.settings.showOnThisDay = value;
          await this.plugin.saveAndRender();
        })
      );

    new Setting(containerEl)
      .setName("显示年度统计")
      .setDesc("显示年度热力图、月份柱状图和标签云。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showYearlyStats).onChange(async (value) => {
          this.plugin.settings.showYearlyStats = value;
          await this.plugin.saveAndRender();
        })
      );

    new Setting(containerEl)
      .setName("热力点颜色")
      .setDesc("年度热力图中已写日记点的颜色。")
      .addDropdown((dropdown) => {
        this.addColorOptions(dropdown);
        dropdown.setValue(this.plugin.settings.heatmapColor).onChange(async (value) => {
          this.plugin.settings.heatmapColor = value;
          await this.plugin.saveAndRender();
        });
      });

    new Setting(containerEl)
      .setName("月份柱状图颜色")
      .setDesc("年度统计中月份柱状图的统一颜色。")
      .addDropdown((dropdown) => {
        this.addColorOptions(dropdown);
        dropdown.setValue(this.plugin.settings.barColor).onChange(async (value) => {
          this.plugin.settings.barColor = value;
          await this.plugin.saveAndRender();
        });
      });

    containerEl.createEl("h3", { text: "工具" });
    new Setting(containerEl)
      .setName("立即重新扫描")
      .setDesc("手动触发全量扫描，用于排查日记未显示等问题。")
      .addButton((buttonEl) =>
        buttonEl.setButtonText("立即扫描").onClick(async () => {
          buttonEl.setButtonText("扫描中...");
          buttonEl.setDisabled(true);
          await this.plugin.recomputeAndRefresh(true);
          buttonEl.setButtonText("完成 ✓");
          window.setTimeout(() => {
            buttonEl.setButtonText("立即扫描");
            buttonEl.setDisabled(false);
          }, 1600);
        })
      );
  }

  addColorOptions(dropdown) {
    for (const [value, config] of Object.entries(COLOR_OPTIONS)) {
      dropdown.addOption(value, config.label);
    }
  }

  updatePreview(container) {
    try {
      container.setText(`预览路径：${this.plugin.statsService.buildDiaryPath(new Date())}`);
      container.style.color = "var(--text-muted)";
      container.style.fontSize = "12px";
      container.style.marginTop = "8px";
      container.style.padding = "6px 10px";
      container.style.background = "var(--background-secondary)";
      container.style.borderRadius = "4px";
    } catch {
      container.setText("路径格式有误");
      container.style.color = "var(--color-red)";
    }
  }
}

module.exports = class DiaryPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.statsService = new DiaryStatsService(this.app, this, this.settings);
    this.registerView(VIEW_TYPE, (leaf) => new DiarySidebarView(leaf, this.statsService, this));
    this.addSettingTab(new DiarySettingTab(this.app, this));

    this.app.workspace.onLayoutReady(async () => {
      await this.activateSidebarView();
      const view = this.getSidebarView();
      if ((await this.statsService.loadCache()) && view) {
        await view.renderFromCache();
        this.recomputeAndRefresh(false);
      } else {
        await this.recomputeAndRefresh(true);
      }
    });

    this.addCommand({
      id: "write-today",
      name: "日记: 写今天",
      callback: async () => this.getSidebarView()?.writeTodayDiary(),
    });
    this.addCommand({
      id: "jump-today",
      name: "日记: 跳转今天",
      callback: async () => this.getSidebarView()?.jumpToTodayDiary(),
    });
    this.addCommand({
      id: "refresh-sidebar",
      name: "日记: 刷新侧栏",
      callback: async () => {
        new Notice("正在刷新侧栏...");
        await this.recomputeAndRefresh(true);
        new Notice("侧栏已刷新");
      },
    });
    this.addRibbonIcon("book-open", "打开日记管理", () => this.activateSidebarView());

    const scheduleRefresh = debounce(() => this.recomputeAndRefresh(false), 800, true);
    this.registerEvent(this.app.vault.on("create", (file) => this.handleVaultChange(file, scheduleRefresh)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.handleVaultChange(file, scheduleRefresh)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.handleVaultChange(file, scheduleRefresh)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.isDiaryPath(file?.path) || this.isDiaryPath(oldPath)) scheduleRefresh();
    }));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  handleVaultChange(file, scheduleRefresh) {
    if (this.isDiaryPath(file?.path)) scheduleRefresh();
  }

  isDiaryPath(path) {
    return Boolean(path && path.startsWith(`${this.settings.diaryRoot}/`));
  }

  async recomputeAndRefresh(showLoading) {
    await this.statsService.recompute();
    await this.statsService.saveCache();
    const view = this.getSidebarView();
    if (view) await view.renderToContainer(showLoading);
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || data);
    delete this.settings.vaultStatsCache;
  }

  async saveSettings() {
    const data = (await this.loadData()) || {};
    await this.saveData({ ...data, settings: this.settings });
  }

  async saveAndApply() {
    await this.saveSettings();
    this.statsService.updateSettings(this.settings);
    await this.recomputeAndRefresh(true);
  }

  async saveAndRender() {
    await this.saveSettings();
    const view = this.getSidebarView();
    if (view) await view.renderToContainer(false);
  }

  getSidebarView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    return leaves.length > 0 ? leaves[0].view : null;
  }

  async activateSidebarView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }
};

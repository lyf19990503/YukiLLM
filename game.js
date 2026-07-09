const SCRIPT_URL = "./剧本.txt";
const TYPE_DELAY_MS = 34;
const LINES_PER_PAGE = 6;
const BACKGROUND_FADE_MS = 720;
const CHARACTER_FADE_MS = 520;
const CHARACTER_POSITIONS = ["left", "center", "right"];

const VISUAL_CONFIG = {
  default: {
    background: "./assets/bg-placeholder.svg",
    characters: {
      left: "",
      center: "",
      right: "",
    },
  },
  cues: [
    // 按页/行切换，可用于后续剧情演出：
    // { page: 3, line: 2, background: "./assets/forest.png", characters: { right: null, left: "./assets/aoko.png" } },
    // 按解析后的文本行序号切换，适合不想依赖分页数量时使用：
    // { globalLine: 24, characters: { center: "./assets/alice.png" } },
  ],
  pages: [
    // 兼容整页段落式切换：
    // { from: 8, background: "./assets/forest.png", characters: { right: "./assets/aoko.png" } },
  ],
};

const elements = {
  game: document.querySelector("#game"),
  backgrounds: [
    document.querySelector("#background-a"),
    document.querySelector("#background-b"),
  ],
  dialogueBox: document.querySelector("#dialogue-box"),
  storyText: document.querySelector("#story-text"),
  progress: document.querySelector("#progress"),
  nextMark: document.querySelector("#next-mark"),
  loading: document.querySelector("#loading"),
  characters: {
    left: document.querySelector("#character-left"),
    center: document.querySelector("#character-center"),
    right: document.querySelector("#character-right"),
  },
};

const state = {
  pages: [],
  scriptCues: [],
  initialVisual: {
    background: VISUAL_CONFIG.default.background,
    characters: { ...VISUAL_CONFIG.default.characters },
  },
  pageIndex: 0,
  lineIndex: 0,
  currentLine: "",
  currentLineElement: null,
  lineChars: [],
  charIndex: 0,
  typingTimer: 0,
  isTyping: false,
  visual: {
    backgroundSlotIndex: 0,
    backgroundSrc: elements.backgrounds[0].getAttribute("src") || "",
    backgroundTarget: elements.backgrounds[0].getAttribute("src") || "",
    backgroundTimer: 0,
    characterSrc: {
      left: elements.characters.left.getAttribute("src") || "",
      center: elements.characters.center.getAttribute("src") || "",
      right: elements.characters.right.getAttribute("src") || "",
    },
    characterTarget: {
      left: elements.characters.left.getAttribute("src") || "",
      center: elements.characters.center.getAttribute("src") || "",
      right: elements.characters.right.getAttribute("src") || "",
    },
    characterTimers: {},
  },
};

init();

async function init() {
  bindControls();

  try {
    const response = await fetch(SCRIPT_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const scriptText = await response.text();
    const parsedScript = parseScript(scriptText);
    state.pages = parsedScript.pages;
    state.scriptCues = parsedScript.cues;
    state.initialVisual = parsedScript.initialVisual;

    if (state.pages.length === 0) {
      throw new Error("empty script");
    }

    applyInitialVisual(state.initialVisual);
    elements.loading.classList.add("is-hidden");
    showPage(0);
  } catch (error) {
    console.error(error);
    elements.loading.textContent = "剧本加载失败，请通过本地静态服务打开页面。";
  }
}

function bindControls() {
  elements.game.addEventListener("pointerdown", advanceStory);

  window.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    advanceStory();
  });
}

function advanceStory() {
  if (state.pages.length === 0) {
    return;
  }

  if (state.isTyping) {
    completeCurrentLine();
    return;
  }

  const page = state.pages[state.pageIndex];

  if (state.lineIndex < page.lines.length - 1) {
    showLine(state.lineIndex + 1);
    return;
  }

  if (state.pageIndex < state.pages.length - 1) {
    showPage(state.pageIndex + 1);
  }
}

function showPage(pageIndex) {
  window.clearTimeout(state.typingTimer);

  state.pageIndex = pageIndex;
  const page = state.pages[pageIndex];
  state.lineIndex = 0;

  elements.storyText.textContent = "";
  elements.progress.textContent = `${pageIndex + 1} / ${state.pages.length}`;
  elements.nextMark.classList.remove("is-ready");
  elements.dialogueBox.classList.toggle("is-title", page.type === "chapter" || page.type === "section");

  showLine(0);
}

function showLine(lineIndex) {
  window.clearTimeout(state.typingTimer);

  const page = state.pages[state.pageIndex];
  state.lineIndex = lineIndex;
  state.currentLine = page.lines[lineIndex];
  state.currentLineElement = document.createElement("div");
  state.currentLineElement.className = "story-line";
  state.lineChars = Array.from(state.currentLine);
  state.charIndex = 0;
  state.isTyping = true;
  elements.nextMark.classList.remove("is-ready");
  updateVisuals(state.pageIndex, lineIndex);

  elements.storyText.append(state.currentLineElement);

  typeNextCharacter();
}

function typeNextCharacter() {
  if (state.charIndex >= state.lineChars.length) {
    state.isTyping = false;
    updateNextMark();
    elements.nextMark.classList.add("is-ready");
    return;
  }

  state.currentLineElement.textContent += state.lineChars[state.charIndex];
  state.charIndex += 1;
  state.typingTimer = window.setTimeout(typeNextCharacter, TYPE_DELAY_MS);
}

function completeCurrentLine() {
  window.clearTimeout(state.typingTimer);

  state.currentLineElement.textContent = state.currentLine;
  state.charIndex = state.lineChars.length;
  state.isTyping = false;
  updateNextMark();
  elements.nextMark.classList.add("is-ready");
}

function updateNextMark() {
  const page = state.pages[state.pageIndex];
  const isLastLine = state.lineIndex >= page.lines.length - 1;
  const isLastPage = state.pageIndex >= state.pages.length - 1;

  elements.nextMark.textContent = isLastLine && isLastPage ? "◆" : "▼";
}

function parseScript(scriptText) {
  const entries = [];
  const cues = [];
  const initialVisual = {
    background: VISUAL_CONFIG.default.background,
    characters: { ...VISUAL_CONFIG.default.characters },
  };
  const lines = scriptText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  let nextDisplayLineIndex = 0;
  let hasInitialBackground = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const directive = parseVisualDirective(line, nextDisplayLineIndex);

    if (directive) {
      if (directive.background && !hasInitialBackground) {
        initialVisual.background = directive.background;
        hasInitialBackground = true;
      } else {
        cues.push(directive);
      }

      continue;
    }

    const heading = line.match(/^(#{3,4})\s*(.+)$/);

    if (heading) {
      entries.push({
        type: heading[1].length === 3 ? "chapter" : "section",
        text: heading[2].trim(),
        globalLine: nextDisplayLineIndex,
      });
      nextDisplayLineIndex += 1;
      continue;
    }

    entries.push({ type: "line", text: line, globalLine: nextDisplayLineIndex });
    nextDisplayLineIndex += 1;
  }

  return {
    pages: groupEntriesIntoPages(entries),
    cues,
    initialVisual,
  };
}

function groupEntriesIntoPages(entries) {
  const pages = [];
  let lineBuffer = [];

  const flushLines = () => {
    while (lineBuffer.length > 0) {
      const lineChunk = lineBuffer.splice(0, LINES_PER_PAGE);

      pages.push({
        type: "line",
        lines: lineChunk.map((line) => line.text),
        lineStartIndex: lineChunk[0]?.globalLine ?? 0,
      });
    }
  };

  for (const entry of entries) {
    if (entry.type !== "line") {
      flushLines();
      pages.push({ type: entry.type, lines: [entry.text], lineStartIndex: entry.globalLine });
      continue;
    }

    lineBuffer.push({ text: entry.text, globalLine: entry.globalLine });

    if (lineBuffer.length >= LINES_PER_PAGE) {
      flushLines();
    }
  }

  flushLines();
  return pages;
}

function parseVisualDirective(line, globalLine) {
  const match = line.match(/^<([^>]+)><([^>]+)>$/);

  if (!match) {
    return null;
  }

  const command = match[1].trim();
  const assetPath = normalizeAssetPath(match[2]);

  if (command === "背景") {
    return { globalLine, background: assetPath };
  }

  const roleMatch = command.match(/^角色(?:进入|从(.+?)退出|退出)(.+)?$/);

  if (!roleMatch) {
    return null;
  }

  const positionText = roleMatch[1] || roleMatch[2] || "";
  const position = normalizeCharacterPosition(positionText);

  if (!position) {
    return null;
  }

  const isExit = command.includes("退出");

  return {
    globalLine,
    characters: {
      [position]: isExit ? null : assetPath,
    },
  };
}

function normalizeAssetPath(assetPath) {
  const normalizedPath = assetPath.trim().replace(/\\/g, "/");

  if (/^(?:https?:|data:|blob:|\.?\.?\/|\/)/.test(normalizedPath)) {
    return normalizedPath;
  }

  return `./${normalizedPath}`;
}

function normalizeCharacterPosition(positionText) {
  if (positionText.includes("左")) {
    return "left";
  }

  if (positionText.includes("右")) {
    return "right";
  }

  if (positionText.includes("中")) {
    return "center";
  }

  return "";
}

function updateVisuals(pageIndex, lineIndex) {
  const visual = resolveVisual(pageIndex, lineIndex);

  setBackground(visual.background);

  for (const position of CHARACTER_POSITIONS) {
    setCharacter(position, visual.characters[position]);
  }
}

function applyInitialVisual(visual) {
  const background = visual.background || VISUAL_CONFIG.default.background;
  const activeBackground = elements.backgrounds[0];
  const inactiveBackground = elements.backgrounds[1];

  activeBackground.src = background;
  activeBackground.classList.add("is-active");
  inactiveBackground.classList.remove("is-active");
  inactiveBackground.removeAttribute("src");
  state.visual.backgroundSlotIndex = 0;
  state.visual.backgroundSrc = background;
  state.visual.backgroundTarget = background;

  for (const position of CHARACTER_POSITIONS) {
    const src = visual.characters[position] || "";
    const element = elements.characters[position];

    state.visual.characterSrc[position] = src;
    state.visual.characterTarget[position] = src;

    if (src) {
      element.src = src;
      element.classList.remove("is-hidden");
    } else {
      element.classList.add("is-hidden");
      element.removeAttribute("src");
    }
  }
}

function resolveVisual(pageIndex, lineIndex) {
  const visual = {
    background: state.initialVisual.background || VISUAL_CONFIG.default.background,
    characters: { ...state.initialVisual.characters },
  };

  for (const entry of VISUAL_CONFIG.pages) {
    if (hasReachedVisualCue(entry, pageIndex, lineIndex)) {
      applyVisualEntry(visual, entry);
    }
  }

  for (const entry of state.scriptCues) {
    if (hasReachedVisualCue(entry, pageIndex, lineIndex)) {
      applyVisualEntry(visual, entry);
    }
  }

  for (const entry of VISUAL_CONFIG.cues) {
    if (hasReachedVisualCue(entry, pageIndex, lineIndex)) {
      applyVisualEntry(visual, entry);
    }
  }

  return visual;
}

function hasReachedVisualCue(entry, pageIndex, lineIndex) {
  if (typeof entry.globalLine === "number") {
    return getGlobalLineIndex(pageIndex, lineIndex) >= entry.globalLine;
  }

  if (typeof entry.page === "number") {
    const entryLine = typeof entry.line === "number" ? entry.line : 0;

    return pageIndex > entry.page || (pageIndex === entry.page && lineIndex >= entryLine);
  }

  if (typeof entry.from === "number") {
    return pageIndex >= entry.from;
  }

  return false;
}

function applyVisualEntry(visual, entry) {
  if (entry.background !== undefined && entry.background !== null) {
    visual.background = entry.background;
  }

  if (entry.characters) {
    visual.characters = {
      ...visual.characters,
      ...entry.characters,
    };
  }
}

function getGlobalLineIndex(pageIndex, lineIndex) {
  return (state.pages[pageIndex]?.lineStartIndex ?? 0) + lineIndex;
}

function setBackground(src) {
  const nextSrc = src || VISUAL_CONFIG.default.background;

  if (state.visual.backgroundTarget === nextSrc) {
    return;
  }

  window.clearTimeout(state.visual.backgroundTimer);

  const currentSlot = elements.backgrounds[state.visual.backgroundSlotIndex];
  const nextSlotIndex = state.visual.backgroundSlotIndex === 0 ? 1 : 0;
  const nextSlot = elements.backgrounds[nextSlotIndex];
  state.visual.backgroundTarget = nextSrc;
  nextSlot.src = nextSrc;

  const activate = () => {
    if (state.visual.backgroundTarget !== nextSrc) {
      return;
    }

    nextSlot.classList.add("is-active");
    currentSlot.classList.remove("is-active");
    state.visual.backgroundSlotIndex = nextSlotIndex;
    state.visual.backgroundSrc = nextSrc;
    state.visual.backgroundTimer = window.setTimeout(() => {
      if (!currentSlot.classList.contains("is-active")) {
        currentSlot.removeAttribute("src");
      }
    }, BACKGROUND_FADE_MS);
  };

  whenImageReady(nextSlot, activate);
}

function setCharacter(position, src) {
  const element = elements.characters[position];
  const nextSrc = src || "";

  if (state.visual.characterTarget[position] === nextSrc) {
    return;
  }

  window.clearTimeout(state.visual.characterTimers[position]);
  state.visual.characterTarget[position] = nextSrc;

  if (!nextSrc) {
    hideCharacter(position);
    return;
  }

  const currentSrc = state.visual.characterSrc[position];
  const isVisible = currentSrc && !element.classList.contains("is-hidden");

  if (isVisible && currentSrc !== nextSrc) {
    element.classList.add("is-hidden");
    state.visual.characterTimers[position] = window.setTimeout(() => {
      showCharacter(position, nextSrc);
    }, CHARACTER_FADE_MS);
    return;
  }

  showCharacter(position, nextSrc);
}

function showCharacter(position, src) {
  if (state.visual.characterTarget[position] !== src) {
    return;
  }

  const element = elements.characters[position];
  element.src = src;

  whenImageReady(element, () => {
    if (state.visual.characterTarget[position] !== src) {
      return;
    }

    state.visual.characterSrc[position] = src;
    element.classList.remove("is-hidden");
  });
}

function hideCharacter(position) {
  const element = elements.characters[position];
  element.classList.add("is-hidden");

  state.visual.characterTimers[position] = window.setTimeout(() => {
    if (state.visual.characterTarget[position]) {
      return;
    }

    state.visual.characterSrc[position] = "";
    element.removeAttribute("src");
  }, CHARACTER_FADE_MS);
}

function whenImageReady(image, callback) {
  if (image.complete && image.naturalWidth > 0) {
    window.requestAnimationFrame(callback);
    return;
  }

  const finish = () => {
    image.removeEventListener("load", finish);
    image.removeEventListener("error", finish);
    callback();
  };

  image.addEventListener("load", finish);
  image.addEventListener("error", finish);
}

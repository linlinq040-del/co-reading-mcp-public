import { buildCardCandidates, pickCard, sharedNoteIdSet } from "./card-logic.js";

const state = {
  books: [],
  chunks: [],
  annotations: [],
  bookId: null,
  chunkId: null,
  chunk: null,
  quote: "",
  quoteOffset: null,
  selectedQuote: "",
  selectedQuoteOffset: null,
  activeAnnotationId: null,
  cardCandidates: [],
  cardIndex: 0,
  lastFinish: null,
  toastTimer: null,
  refreshInFlight: false,
  composing: false,
  replyDrafts: {},
  spreadPage: 0,
  spreadPages: 1,
  spreadTouchX: null,
  pageTurning: false,
  spreadRanges: [],
  pendingSpreadRatio: null,
  libraryAnnotations: [],
  booksRenderSignature: "",
  libraryNotesRenderSignature: "",
  libraryNoteQuery: "",
  libraryNoteBook: "",
  expandedLibraryQuotes: new Set(),
  autoMarkingChunks: new Set(),
  repairingAnnotationAnchors: new Set(),
  chunkOpenedAt: 0,
  chapterHadReadingMotion: false,
  positionSaveTimer: null,
  lastPositionSignature: "",
  replyInboxSince: new Date().toISOString(),
  replyInboxAnnotations: [],
  replyInboxItems: [],
  replyInboxVisibleCount: 5,
  replyInboxDrafts: {},
  replyInboxSignature: "",
  knownReplyInboxIds: new Set(),
  seenReplyInboxIds: new Set(),
  replyInboxInitialized: false,
  config: {
    configured: false,
    roomName: "共读空间",
    readerName: "我",
    partnerName: "共读伙伴",
    welcomeText: "把喜欢的句子，留在同一页里。",
  },
};

const $ = (id) => document.getElementById(id);
const splashStartedAt = performance.now();
const authTokenKey = "co-reading-auth-token";
const themeStorageKey = "co-reading-theme";
const themeColors = {
  blackcat: "#17161d",
  rabbit: "#f3e9dc",
  duo: "#e8e0eb",
  forest: "#dfe5d7",
  berry: "#f8dfe5",
  ocean: "#dce8e2",
  bookshop: "#bba78c",
};
const urlToken = new URLSearchParams(location.search).get("token");
if (urlToken) {
  localStorage.setItem(authTokenKey, urlToken);
  history.replaceState(null, "", location.pathname);
}

async function api(path, options = {}) {
  const token = localStorage.getItem(authTokenKey);
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function readerName() {
  return state.config.readerName || "我";
}

function partnerName() {
  return state.config.partnerName || "共读伙伴";
}

function applyRoomConfig(config) {
  state.config = { ...state.config, ...config };
  document.title = `${state.config.roomName} · 共读`;
  $("room-name").textContent = state.config.roomName;
  if ($("splash-room-name")) $("splash-room-name").textContent = state.config.roomName;
  $("welcome-note").textContent = state.config.welcomeText;
  $("notes-entry-copy").textContent = `${readerName()}和${partnerName()}留在书页旁的话`;
  $("inbox-partner-name").textContent = partnerName();
  $("partner-inbox-toggle").title = `查看${partnerName()}的最新回复`;
  $("partner-inbox").setAttribute("aria-label", `${partnerName()}最新回复`);
}

function fillSettingsForm() {
  $("setting-room-name").value = state.config.roomName;
  $("setting-reader-name").value = state.config.readerName;
  $("setting-partner-name").value = state.config.partnerName;
  $("setting-welcome-text").value = state.config.welcomeText;
}

function setSettingsPanel(open, { required = false } = {}) {
  const panel = $("settings-panel");
  panel.hidden = !open;
  panel.dataset.required = required ? "true" : "false";
  document.body.classList.toggle("settings-open", open);
  panel.querySelectorAll("[data-close-settings], #settings-cancel").forEach((button) => {
    button.hidden = required;
  });
  $("settings-kicker").textContent = required ? "FIRST VISIT" : "SPACE SETTINGS";
  $("settings-title").textContent = required ? "布置你的共读空间" : "共读空间设置";
  if (open) {
    fillSettingsForm();
    requestAnimationFrame(() => $("setting-room-name").focus());
  }
}

async function loadRoomConfig() {
  const config = await api("/api/config");
  applyRoomConfig(config);
  if (!config.configured) setSettingsPanel(true, { required: true });
}

function applyTheme(theme, { persist = true } = {}) {
  if (!Object.prototype.hasOwnProperty.call(themeColors, theme)) return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme]);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (persist) localStorage.setItem(themeStorageKey, theme);
}

function setThemePicker(open) {
  const picker = $("theme-picker");
  if (!picker) return;
  picker.hidden = !open;
  document.body.classList.toggle("theme-picker-open", open);
  if (open) requestAnimationFrame(() => picker.querySelector(".theme-option.active, .theme-option")?.focus());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      let binary = "";
      const size = 0x8000;
      for (let index = 0; index < bytes.length; index += size) {
        binary += String.fromCharCode(...bytes.subarray(index, index + size));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 1366px)").matches;
}

function isBookSpreadLayout() {
  return window.matchMedia("(min-width: 981px) and (max-width: 1366px) and (orientation: landscape)").matches;
}

function readingPositionPayload() {
  if (!state.bookId || !state.chunkId || !state.chunk) return null;
  if (isBookSpreadLayout()) {
    const pageStart = state.spreadRanges[state.spreadPage * 2]?.start || 0;
    const textLength = Math.max(1, state.chunk.text?.length || 0);
    return {
      bookId: state.bookId,
      chunkId: state.chunkId,
      spreadPage: state.spreadPage,
      scrollRatio: Math.max(0, Math.min(1, pageStart / textLength)),
      layout: "spread",
    };
  }
  const text = $("text");
  if (!text) return null;
  const rect = text.getBoundingClientRect();
  const textTop = window.scrollY + rect.top;
  const readableHeight = Math.max(1, text.scrollHeight - Math.min(window.innerHeight * 0.55, 480));
  const scrollRatio = Math.max(0, Math.min(1, (window.scrollY - textTop) / readableHeight));
  return {
    bookId: state.bookId,
    chunkId: state.chunkId,
    spreadPage: 0,
    scrollRatio,
    layout: "scroll",
  };
}

function saveReadingPosition({ immediate = false, keepalive = false } = {}) {
  clearTimeout(state.positionSaveTimer);
  const save = () => {
    const payload = readingPositionPayload();
    if (!payload) return;
    const signature = JSON.stringify(payload);
    if (!keepalive && signature === state.lastPositionSignature) return;
    state.lastPositionSignature = signature;
    api("/api/reading-position", { method: "POST", body: payload, keepalive }).catch((error) => {
      console.warn("Could not save reading position", error);
      if (!keepalive) state.lastPositionSignature = "";
    });
  };
  if (immediate) save();
  else state.positionSaveTimer = setTimeout(save, 900);
}

function restoreScrollPosition(position) {
  if (!position || isBookSpreadLayout()) return;
  const ratio = Math.max(0, Math.min(1, Number(position.scrollRatio) || 0));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const text = $("text");
    if (!text) return;
    const rect = text.getBoundingClientRect();
    const textTop = window.scrollY + rect.top;
    const readableHeight = Math.max(1, text.scrollHeight - Math.min(window.innerHeight * 0.55, 480));
    window.scrollTo({ top: Math.max(0, textTop + readableHeight * ratio), behavior: "auto" });
  }));
}

function scrollToPanel(selector) {
  if (!isMobileLayout()) return;
  requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  state.toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 2400);
}

function formatIdentity(author) {
  const value = String(author || "unknown").toLowerCase();
  if (["user", "koshi", "human", "you"].includes(value)) return readerName();
  if (value === "assistant" || value === "claude" || value === "ember" || value === "partner") return partnerName();
  return value;
}

function annotationTone(author) {
  const value = String(author || "").toLowerCase();
  if (value === "assistant" || value === "claude" || value === "ember" || value === "partner") return "partner";
  if (["user", "koshi", "human", "you"].includes(value)) return "mine";
  return "neutral";
}

function cleanBookTitle(value) {
  const raw = String(value || "").trim();
  if (!raw) return "未命名书籍";
  const candidates = raw
    .split(/_{2,}|\s+[—–|]\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/(z-?lib|1lib|\.epub|\.txt|\.md|https?:|www\.)/i.test(part));
  return (candidates[0] || raw).replace(/[_-]+$/g, "").trim();
}

function searchableText(value) {
  const source = String(value || "");
  let normalized = "";
  const positions = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!/[\p{L}\p{N}]/u.test(character)) continue;
    normalized += character.toLocaleLowerCase();
    positions.push(index);
  }
  return { normalized, positions };
}

function findQuoteAnchor(text, note) {
  const savedAnchorQuote = String(note?.anchorQuote || "");
  const savedAnchorOffset = Number(note?.anchorOffset);
  if (
    savedAnchorQuote &&
    Number.isInteger(savedAnchorOffset) &&
    savedAnchorOffset >= 0 &&
    text.slice(savedAnchorOffset, savedAnchorOffset + savedAnchorQuote.length) === savedAnchorQuote
  ) {
    return { start: savedAnchorOffset, end: savedAnchorOffset + savedAnchorQuote.length, quality: "repaired" };
  }

  const quote = String(note?.quote || "");
  if (!quote) return null;
  const requestedOffset = Number(note?.quoteOffset);
  if (
    Number.isInteger(requestedOffset) &&
    requestedOffset >= 0 &&
    text.slice(requestedOffset, requestedOffset + quote.length) === quote
  ) {
    return { start: requestedOffset, end: requestedOffset + quote.length, quality: "exact" };
  }

  const exactStart = text.indexOf(quote);
  if (exactStart >= 0) return { start: exactStart, end: exactStart + quote.length, quality: "exact" };

  const source = searchableText(text);
  const target = searchableText(quote);
  if (!source.normalized || !target.normalized) return null;
  const normalizedStart = source.normalized.indexOf(target.normalized);
  if (normalizedStart >= 0) {
    return {
      start: source.positions[normalizedStart],
      end: source.positions[normalizedStart + target.normalized.length - 1] + 1,
      quality: "normalized",
    };
  }

  // The assistant may occasionally paraphrase the quoted passage. Anchor the note to
  // the longest verbatim fragment that still occurs in the chapter.
  const previous = new Uint32Array(target.normalized.length + 1);
  let bestLength = 0;
  let bestSourceEnd = 0;
  for (let sourceIndex = 1; sourceIndex <= source.normalized.length; sourceIndex += 1) {
    let diagonal = 0;
    for (let targetIndex = 1; targetIndex <= target.normalized.length; targetIndex += 1) {
      const old = previous[targetIndex];
      if (source.normalized[sourceIndex - 1] === target.normalized[targetIndex - 1]) {
        previous[targetIndex] = diagonal + 1;
        if (previous[targetIndex] > bestLength) {
          bestLength = previous[targetIndex];
          bestSourceEnd = sourceIndex;
        }
      } else {
        previous[targetIndex] = 0;
      }
      diagonal = old;
    }
  }
  const minimum = Math.max(5, Math.min(12, Math.floor(target.normalized.length * 0.35)));
  if (bestLength < minimum) return null;
  const bestSourceStart = bestSourceEnd - bestLength;
  return {
    start: source.positions[bestSourceStart],
    end: source.positions[bestSourceEnd - 1] + 1,
    quality: "fragment",
  };
}

function persistRepairedAnchor(note, anchor, text) {
  if (!note?.id || !anchor || state.repairingAnnotationAnchors.has(note.id)) return;
  const anchorQuote = text.slice(anchor.start, anchor.end);
  if (!anchorQuote) return;
  if (note.anchorQuote === anchorQuote && Number(note.anchorOffset) === anchor.start) return;

  state.repairingAnnotationAnchors.add(note.id);
  api(`/api/annotations/${encodeURIComponent(note.id)}/anchor`, {
    method: "PATCH",
    body: { anchorQuote, anchorOffset: anchor.start },
  })
    .then((updated) => {
      Object.assign(note, updated);
      const libraryCopy = state.libraryAnnotations.find((item) => item.id === note.id);
      if (libraryCopy) Object.assign(libraryCopy, updated);
    })
    .catch((error) => console.warn("Could not persist repaired annotation anchor", error))
    .finally(() => state.repairingAnnotationAnchors.delete(note.id));
}

function replyClass(reply, root) {
  const sameAuthor = String(reply.author || "").toLowerCase() === String(root.author || "").toLowerCase();
  return sameAuthor ? "reply root-author" : "reply other-author";
}

function repliesFor(parentId, notes) {
  return notes.filter((item) => item.parentId === parentId);
}

function replyCount(parentId, notes, seen = new Set()) {
  if (seen.has(parentId)) return 0;
  seen.add(parentId);
  return repliesFor(parentId, notes).reduce((count, reply) => count + 1 + replyCount(reply.id, notes, seen), 0);
}

function renderReply(reply, root, notes, depth = 1, seen = new Set()) {
  if (!reply.id || seen.has(reply.id)) return "";
  const nextSeen = new Set(seen);
  nextSeen.add(reply.id);
  const children = repliesFor(reply.id, notes);
  const visibleDepth = Math.min(depth, 4);
  return `<div class="${replyClass(reply, root)}" style="--reply-depth: ${visibleDepth}">
    <p class="reply-body">${escapeHtml(reply.note)}</p>
    <div class="note-meta">${escapeHtml(formatIdentity(reply.author))} · ${escapeHtml(reply.kind || "reply")}</div>
    ${
      children.length
        ? `<div class="reply-children">${children
            .map((child) => renderReply(child, root, notes, depth + 1, nextSeen))
            .join("")}</div>`
        : ""
    }
  </div>`;
}

function renderThread(note, notes) {
  const replies = repliesFor(note.id, notes);
  const draft = state.replyDrafts[note.id] || "";
  return `<div class="thread">
    ${replies.map((reply) => renderReply(reply, note, notes, 1, new Set([note.id]))).join("")}
    <form class="reply-form" data-parent-id="${escapeHtml(note.id)}">
      <textarea rows="2" placeholder="Reply in this margin...">${escapeHtml(draft)}</textarea>
      <button type="submit" class="primary-button">Reply</button>
    </form>
  </div>`;
}

function latestPartnerReplies(annotations) {
  const byId = new Map(annotations.map((note) => [note.id, note]));
  const since = new Date(state.replyInboxSince).getTime();
  return annotations
    .filter((reply) => {
      if (!reply.parentId || annotationTone(reply.author) !== "partner") return false;
      const parent = byId.get(reply.parentId);
      if (!parent || annotationTone(parent.author) !== "mine") return false;
      return new Date(reply.createdAt || 0).getTime() > since;
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .map((reply) => ({ reply, parent: byId.get(reply.parentId) }));
}

function renderReplyInbox() {
  const list = $("partner-inbox-list");
  const count = $("partner-inbox-count");
  const button = $("partner-inbox-toggle");
  if (!list || !count || !button) return;
  const items = state.replyInboxItems.slice(0, state.replyInboxVisibleCount);
  const unreadCount = state.replyInboxItems.filter(({ reply }) => !state.seenReplyInboxIds.has(reply.id)).length;
  count.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  count.hidden = unreadCount === 0;
  button.classList.toggle("has-new", unreadCount > 0);
  const signature = JSON.stringify(items.map(({ reply, parent }) => [reply.id, reply.note, reply.createdAt, parent?.id, parent?.note]));
  if (signature === state.replyInboxSignature) return;
  if (document.activeElement?.closest?.(".partner-inbox-reply-form")) return;
  state.replyInboxSignature = signature;
  if (!items.length) {
    list.innerHTML = `<div class="partner-inbox-empty"><span>☾</span><strong>暂时没有新回信</strong><p>继续读吧，${escapeHtml(partnerName())}的下一条回复会出现在这里。</p></div>`;
    return;
  }
  const books = new Map(state.books.map((book) => [book.bookId, book]));
  const cards = items.map(({ reply, parent }) => {
    const book = books.get(reply.bookId);
    const draft = state.replyInboxDrafts[reply.id] || "";
    return `<article class="partner-inbox-card" data-inbox-reply="${escapeHtml(reply.id)}">
      <header>
        <span>${escapeHtml(partnerName())}刚刚回了${escapeHtml(readerName())}</span>
        <time>${escapeHtml(new Date(reply.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))}</time>
      </header>
      <p class="partner-inbox-location">《${escapeHtml(cleanBookTitle(book?.title || reply.bookId || "未命名书籍"))}》 · ${escapeHtml(reply.chunkId || "未知章节")}</p>
      ${reply.quote ? `<blockquote>${escapeHtml(reply.quote)}</blockquote>` : ""}
      <section class="partner-inbox-parent"><small>他回复的是你的这条：</small><p>${escapeHtml(parent?.note || "")}</p></section>
      <section class="partner-inbox-message"><small>${escapeHtml(partnerName())}：</small><p>${escapeHtml(reply.note || "")}</p></section>
      <form class="partner-inbox-reply-form" data-inbox-parent="${escapeHtml(reply.id)}">
        <textarea rows="2" placeholder="直接回${escapeHtml(partnerName())}……">${escapeHtml(draft)}</textarea>
        <button class="primary-button" type="submit">回复</button>
      </form>
    </article>`;
  }).join("");
  const remaining = state.replyInboxItems.length - items.length;
  list.innerHTML = `${cards}${remaining > 0 ? `<button class="partner-inbox-more" type="button" data-inbox-more>还有 ${remaining} 条，继续查看</button>` : ""}`;
}

async function refreshReplyInbox({ announce = true } = {}) {
  const annotations = await api("/api/annotations");
  const items = latestPartnerReplies(annotations);
  const ids = new Set(items.map(({ reply }) => reply.id));
  if (state.replyInboxInitialized && announce) {
    const fresh = [...ids].filter((id) => !state.knownReplyInboxIds.has(id));
    if (fresh.length) showToast(`${partnerName()}新回了你 ${fresh.length} 条批注`);
  }
  state.replyInboxAnnotations = annotations;
  state.replyInboxItems = items;
  if (!$("partner-inbox")?.hidden) {
    items.forEach(({ reply }) => state.seenReplyInboxIds.add(reply.id));
  }
  state.knownReplyInboxIds = ids;
  state.replyInboxInitialized = true;
  renderReplyInbox();
}

function setReplyInbox(open) {
  const panel = $("partner-inbox");
  const button = $("partner-inbox-toggle");
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("partner-inbox-open", open);
  if (open) {
    state.replyInboxItems.forEach(({ reply }) => state.seenReplyInboxIds.add(reply.id));
    state.replyInboxVisibleCount = 5;
    state.replyInboxSignature = "";
    renderReplyInbox();
  }
}

function renderInlineNote(note, notes) {
  const canDelete = note.author === "user" && ["open", "private", "draft"].includes(note.status || "open");
  return `<aside class="inline-note ${annotationTone(note.author)}-note" data-note-id="${escapeHtml(note.id)}">
    ${canDelete ? `<button class="note-delete" type="button" data-delete-note="${escapeHtml(note.id)}">删除</button>` : ""}
    <p class="inline-note-kicker">${escapeHtml(formatIdentity(note.author))} · ${escapeHtml(note.kind || "note")}</p>
    <p class="note-body">${escapeHtml(note.note)}</p>
    ${renderThread(note, notes)}
  </aside>`;
}

function renderBooks() {
  const signature = JSON.stringify({
    active: state.bookId,
    books: state.books.map((book) => ({
      id: book.bookId,
      title: book.title,
      author: book.author,
      cover: book.coverUrl,
      read: book.chunksRead,
      total: book.chunkCount,
    })),
  });
  if (signature === state.booksRenderSignature) return;
  state.booksRenderSignature = signature;
  $("books").innerHTML = state.books
    .map((book) => {
      const total = book.chunkCount || 0;
      const read = book.chunksRead || 0;
      const pct = total ? Math.round((read / total) * 100) : 0;
      const hue = Array.from(book.bookId || "book").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 42;
      return `<div class="book-row ${book.bookId === state.bookId ? "active" : ""}">
        <button class="book" data-book="${escapeHtml(book.bookId)}">
          <span class="book-cover" style="--cover-hue:${hue}">
            <span class="book-cover-fallback">
              <span class="cover-title">${escapeHtml(cleanBookTitle(book.title || book.bookId))}</span>
              <span class="cover-author">${escapeHtml(book.author || "共读书房")}</span>
            </span>
            ${book.coverUrl ? `<img src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(cleanBookTitle(book.title || book.bookId))}封面" loading="lazy" />` : ""}
          </span>
          <span class="book-info">
            <span class="book-title">${escapeHtml(cleanBookTitle(book.title || book.bookId))}</span>
            <span class="book-meta">${escapeHtml(book.author || "未知作者")}</span>
            <span class="book-progress-label">${pct ? `${pct}% 已读` : "尚未开始"}</span>
            <span class="progress"><span style="width: ${pct}%"></span></span>
          </span>
        </button>
        <button class="book-rename" data-rename-book="${escapeHtml(book.bookId)}" title="重命名这本书" aria-label="重命名 ${escapeHtml(cleanBookTitle(book.title || book.bookId))}">✎</button>
        <button class="book-delete" data-delete-book="${escapeHtml(book.bookId)}" title="删除这本书">×</button>
      </div>`;
    })
    .join("");
  document.querySelectorAll(".book-cover img").forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
}

function renderChunks() {
  $("chunks").innerHTML = state.chunks
    .map(
      (chunk) => `<button class="chunk ${chunk.id === state.chunkId ? "active" : ""}" data-chunk="${escapeHtml(chunk.id)}">
        <span class="chunk-title">${escapeHtml(chunk.title)}</span>
        <span class="chunk-meta">${escapeHtml(chunk.id)} · ${chunk.read ? "read" : "unread"} · ${chunk.annotationCount || 0} notes</span>
      </button>`,
    )
    .join("");
}

function rootAnnotationId(note, notes) {
  let current = note;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = notes.find((item) => item.id === current.parentId) || current;
    if (!current.parentId) break;
  }
  return current?.id || note.id;
}

function passageGroups(notes) {
  const groups = new Map();
  const roots = notes.filter((note) => !note.parentId);
  for (const root of roots) {
    const quoteKey = String(root.quote || "").replace(/\s+/g, "").trim();
    const key = `${root.chunkId || ""}::${quoteKey || root.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        chunkId: root.chunkId,
        quote: root.quote || "",
        rootId: root.id,
        createdAt: root.createdAt || "",
        notes: [],
      });
    }
    groups.get(key).notes.push(root);
  }
  for (const note of notes.filter((item) => item.parentId)) {
    const rootId = rootAnnotationId(note, notes);
    const group = [...groups.values()].find((item) => item.notes.some((entry) => entry.id === rootId));
    if (group) group.notes.push(note);
  }
  return [...groups.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function renderLibraryNotes() {
  const list = $("library-notes-list");
  if (!list) return;
  const notes = [...state.libraryAnnotations].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const query = state.libraryNoteQuery.trim().toLocaleLowerCase();
  const signature = JSON.stringify({
    books: state.books.map((book) => [book.bookId, book.title, book.author]),
    notes: notes.map((note) => [note.id, note.status, note.note, note.quote, note.parentId]),
    query,
    selectedBook: state.libraryNoteBook,
  });
  if (signature === state.libraryNotesRenderSignature) return;
  const openBooks = new Set(
    [...list.querySelectorAll("details[open][data-note-book]")].map((details) => details.dataset.noteBook),
  );
  state.libraryNotesRenderSignature = signature;
  const groups = state.books
    .filter((book) => !state.libraryNoteBook || book.bookId === state.libraryNoteBook)
    .map((book) => ({
      book,
      notes: notes.filter((note) => note.bookId === book.bookId),
    }))
    .filter((group) => group.notes.length)
    .filter((group) => {
      if (!query) return true;
      return group.notes.some((note) => [group.book.title, group.book.author, note.quote, note.note, formatIdentity(note.author), note.chunkId]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query)));
    });
  if (!groups.length) {
    list.innerHTML = `<p class="library-notes-empty">手札里还没有页边话。读到喜欢的句子时，把它留在这里吧。</p>`;
    return;
  }
  list.innerHTML = groups
    .map(({ book, notes: bookNotes }) => `<details class="library-note-book" data-note-book="${escapeHtml(book.bookId)}" ${openBooks.has(book.bookId) ? "open" : ""}>
      <summary>
        <span class="library-note-mark">${escapeHtml(cleanBookTitle(book.title || book.bookId).slice(0, 1))}</span>
        <span class="library-note-identity">
          <strong>${escapeHtml(cleanBookTitle(book.title || book.bookId))}</strong>
          <small>${escapeHtml(book.author || "未知作者")} · ${bookNotes.length} 条</small>
        </span>
        <span class="library-note-chevron">⌄</span>
      </summary>
      <div class="library-book-annotations">
        ${passageGroups(bookNotes).filter((passage) => !query || passage.notes.some((note) => [passage.quote, note.note, formatIdentity(note.author), note.chunkId]
          .some((value) => String(value || "").toLocaleLowerCase().includes(query)))).map((passage) => `<article class="library-annotation-card passage-conversation">
          <span class="annotation-index-meta">${escapeHtml(passage.chunkId || "未知章节")} · ${passage.notes.length} 条页边话</span>
          ${passage.quote ? `<div class="passage-quote-wrap ${state.expandedLibraryQuotes.has(passage.rootId) ? "expanded" : ""}" data-library-quote="${escapeHtml(passage.rootId)}">
            <blockquote class="annotation-index-quote passage-quote">${escapeHtml(passage.quote)}</blockquote>
            <button class="passage-quote-toggle" type="button" data-toggle-library-quote="${escapeHtml(passage.rootId)}" aria-expanded="${state.expandedLibraryQuotes.has(passage.rootId)}" hidden>${state.expandedLibraryQuotes.has(passage.rootId) ? "收起原文" : "展开原文"}</button>
          </div>` : ""}
          <div class="passage-voices">
            ${passage.notes.map((note) => `<section class="passage-voice ${annotationTone(note.author) === "partner" ? "partner-voice" : "my-voice"}">
              <span class="passage-speaker">${escapeHtml(formatIdentity(note.author))}</span>
              <p class="annotation-index-note">${escapeHtml(note.note || "")}</p>
              <span class="annotation-index-kind">${escapeHtml(note.kind || "note")}${(note.status || "") === "open" ? " · 尚未发送" : ""}</span>
            </section>`).join("")}
          </div>
          <footer class="library-annotation-footer">
            <span class="conversation-mark">同一页上的回声</span>
            <button type="button" class="jump-to-source" data-jump-book="${escapeHtml(book.bookId)}" data-jump-chunk="${escapeHtml(passage.chunkId)}" data-jump-note="${escapeHtml(passage.rootId)}">回到原文</button>
          </footer>
        </article>`).join("")}
      </div>
    </details>`)
    .join("");
  requestAnimationFrame(updateLibraryQuoteToggles);
}

function updateLibraryQuoteToggles() {
  document.querySelectorAll(".passage-quote-wrap").forEach((wrap) => {
    const quote = wrap.querySelector(".passage-quote");
    const toggle = wrap.querySelector(".passage-quote-toggle");
    if (!quote || !toggle) return;
    const expanded = wrap.classList.contains("expanded");
    const overflowing = expanded || quote.scrollHeight > quote.clientHeight + 2;
    quote.classList.toggle("has-overflow", overflowing && !expanded);
    toggle.hidden = !overflowing;
    toggle.textContent = expanded ? "收起原文" : "展开原文";
    toggle.setAttribute("aria-expanded", String(expanded));
  });
}

async function setLibraryNotes(open) {
  $("library-notes").hidden = !open;
  $("books").hidden = open;
  $("open-library-notes").hidden = open;
  document.querySelector(".sidebar .topbar").hidden = open;
  if (!open) return;
  state.libraryAnnotations = await api("/api/annotations");
  const booksWithNotes = new Set(state.libraryAnnotations.map((note) => note.bookId));
  $("library-note-book-filter").innerHTML = `<option value="">全部书籍</option>${state.books
    .filter((book) => booksWithNotes.has(book.bookId))
    .map((book) => `<option value="${escapeHtml(book.bookId)}">${escapeHtml(cleanBookTitle(book.title || book.bookId))}</option>`)
    .join("")}`;
  $("library-note-book-filter").value = state.libraryNoteBook;
  renderLibraryNotes();
}

function renderText() {
  if (!state.chunk) return;
  const text = state.chunk.text || "";
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const sharedIds = sharedNoteIdSet(notes);
  const rootNotes = notes
    .filter((item) => !item.parentId && item.quote)
    .sort((a, b) => {
      const left = Number.isInteger(a.quoteOffset) ? a.quoteOffset : text.indexOf(a.quote);
      const right = Number.isInteger(b.quoteOffset) ? b.quoteOffset : text.indexOf(b.quote);
      return left - right;
    });
  const candidates = [];
  for (const note of rootNotes) {
    const anchor = findQuoteAnchor(text, note);
    if (!anchor) continue;
    const { start, end } = anchor;
    candidates.push({ start, end, note, shared: sharedIds.has(note.id), anchorQuality: anchor.quality });
    const storedOffset = Number(note.anchorOffset ?? note.quoteOffset);
    const storedQuote = String(note.anchorQuote || note.quote || "");
    if (storedOffset !== start || text.slice(start, end) !== storedQuote) {
      persistRepairedAnchor(note, anchor, text);
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.end - a.end || String(a.note.id).localeCompare(String(b.note.id)));
  const highlights = [];
  const occupied = [];
  for (const candidate of candidates) {
    if (occupied.some((range) => candidate.start < range.end && candidate.end > range.start)) continue;
    occupied.push({ start: candidate.start, end: candidate.end });
    highlights.push(candidate);
  }

  if (isBookSpreadLayout()) {
    renderMeasuredSpread(text, highlights);
    bindMarkActions();
    updatePageTurner();
    if (state.activeAnnotationId) showSpreadAnnotation(state.activeAnnotationId);
    else hideSpreadAnnotation();
    return;
  }

  let html = "";
  let cursor = 0;
  for (const highlight of highlights) {
    html += escapeHtml(text.slice(cursor, highlight.start));
    const quote = escapeHtml(text.slice(highlight.start, highlight.end));
    const bookmark = highlight.shared ? `<span class="shared-bookmark" title="这里有两个人的折痕。">此处有回声</span>` : "";
    html += `<mark class="${highlight.note.id === state.activeAnnotationId ? "active" : ""} ${highlight.shared ? "shared" : annotationTone(highlight.note.author)}" data-note-id="${escapeHtml(highlight.note.id)}" title="${escapeHtml(highlight.note.note)}">${quote}</mark>${bookmark}${
      highlight.note.id === state.activeAnnotationId && !isBookSpreadLayout() ? renderInlineNote(highlight.note, notes) : ""
    }`;
    cursor = highlight.end;
  }
  html += escapeHtml(text.slice(cursor));
  $("text").innerHTML = html;
  bindMarkActions();
  requestAnimationFrame(() => updatePageTurner());
  if (isBookSpreadLayout() && state.activeAnnotationId) {
    showSpreadAnnotation(state.activeAnnotationId);
  } else {
    hideSpreadAnnotation();
  }
}

function pageMetrics() {
  const textEl = $("text");
  const fontSize = 18;
  const lineHeight = fontSize * 1.86;
  return {
    innerWidth: Math.max(300, textEl.clientWidth / 2 - 118),
    maxLines: Math.max(8, Math.floor((textEl.clientHeight - 82) / lineHeight) - 1),
    fontSize,
  };
}

function measuredPageRanges(text) {
  if (!text) return [{ start: 0, end: 0 }];
  const { innerWidth, maxLines, fontSize } = pageMetrics();
  const canvas = measuredPageRanges.canvas || (measuredPageRanges.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = `${fontSize}px "Songti SC", "STSong", serif`;
  const ranges = [];
  let start = 0;

  while (start < text.length) {
    let index = start;
    let lines = 1;
    let line = "";
    let lastComfortableBreak = -1;

    while (index < text.length) {
      const character = text[index];
      if (character === "\r") {
        index += 1;
        continue;
      }
      if (character === "\n") {
        lines += 1;
        line = "";
        lastComfortableBreak = index + 1;
        index += 1;
        if (lines > maxLines) break;
        continue;
      }

      const nextLine = line + character;
      if (context.measureText(nextLine).width > innerWidth && line) {
        lines += 1;
        line = character;
        if (lines > maxLines) break;
      } else {
        line = nextLine;
      }
      if (/[。！？；：.!?;:]|\s/.test(character)) lastComfortableBreak = index + 1;
      index += 1;
    }

    let end = Math.max(start + 1, index);
    if (index < text.length && lastComfortableBreak > start + 24 && end - lastComfortableBreak < 24) {
      end = lastComfortableBreak;
    }
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function renderPageSlice(text, range, highlights) {
  if (!range || range.start >= range.end) return `<p class="page-empty">本章至此，轻轻翻页继续。</p>`;
  const relevant = highlights.filter((item) => item.start < range.end && item.end > range.start);
  let html = "";
  let cursor = range.start;
  for (const highlight of relevant) {
    const markStart = Math.max(range.start, highlight.start);
    const markEnd = Math.min(range.end, highlight.end);
    if (markStart > cursor) html += escapeHtml(text.slice(cursor, markStart));
    const quote = escapeHtml(text.slice(markStart, markEnd));
    html += `<mark class="${highlight.note.id === state.activeAnnotationId ? "active" : ""} ${highlight.shared ? "shared" : annotationTone(highlight.note.author)}" data-note-id="${escapeHtml(highlight.note.id)}" title="${escapeHtml(highlight.note.note)}">${quote}</mark>`;
    cursor = markEnd;
  }
  if (cursor < range.end) html += escapeHtml(text.slice(cursor, range.end));
  return html;
}

function renderMeasuredSpread(text, highlights) {
  state.spreadRanges = measuredPageRanges(text);
  state.spreadPages = Math.max(1, Math.ceil(state.spreadRanges.length / 2));
  if (state.pendingSpreadRatio !== null) {
    const targetOffset = Math.floor(text.length * state.pendingSpreadRatio);
    const matchedLeaf = state.spreadRanges.findIndex((range) => targetOffset < range.end);
    const leafIndex = matchedLeaf >= 0 ? matchedLeaf : Math.max(0, state.spreadRanges.length - 1);
    state.spreadPage = Math.floor(leafIndex / 2);
    state.pendingSpreadRatio = null;
  }
  state.spreadPage = Math.min(state.spreadPage, state.spreadPages - 1);
  const leftIndex = state.spreadPage * 2;
  const left = state.spreadRanges[leftIndex] || { start: text.length, end: text.length };
  const right = state.spreadRanges[leftIndex + 1] || { start: text.length, end: text.length };
  $("text").innerHTML = `<div class="book-spread">
    <section class="book-page book-page-left" data-page-start="${left.start}">
      <div class="book-page-content">${renderPageSlice(text, left, highlights)}</div>
      <span class="leaf-number">${leftIndex + 1}</span>
    </section>
    <section class="book-page book-page-right" data-page-start="${right.start}">
      <div class="book-page-content">${renderPageSlice(text, right, highlights)}</div>
      <span class="leaf-number">${leftIndex + 2}</span>
    </section>
  </div>`;
}

function spreadPopover() {
  let popover = document.querySelector(".spread-annotation-popover");
  if (popover) return popover;
  popover = document.createElement("aside");
  popover.className = "spread-annotation-popover";
  popover.hidden = true;
  document.body.append(popover);
  popover.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-spread-note]")) {
      state.activeAnnotationId = null;
      hideSpreadAnnotation();
      renderText();
      renderAnnotations();
    }
  });
  return popover;
}

function hideSpreadAnnotation() {
  const popover = document.querySelector(".spread-annotation-popover");
  if (popover) popover.hidden = true;
}

function updatePageTurner({ reset = false } = {}) {
  const text = $("text");
  const turner = $("page-turner");
  if (!text || !turner) return;
  const active = isBookSpreadLayout() && Boolean(state.chunk);
  turner.classList.toggle("active", active);
  if (!active) return;

  state.spreadPages = Math.max(1, Math.ceil(state.spreadRanges.length / 2));
  if (reset) {
    state.spreadPage = 0;
    renderText();
  } else {
    state.spreadPage = Math.min(state.spreadPage, state.spreadPages - 1);
  }
  $("page-number").textContent = `${state.spreadPage + 1} / ${state.spreadPages}`;
  $("page-prev").disabled = state.spreadPage <= 0 && !state.chunk?.prevId;
  $("page-next").disabled = state.spreadPage >= state.spreadPages - 1 && !state.chunk?.nextId;
}

function turnSpread(direction) {
  if (!isBookSpreadLayout() || state.pageTurning) return;
  const target = Math.max(0, Math.min(state.spreadPages - 1, state.spreadPage + direction));
  const boundaryChunkId = direction > 0 ? state.chunk?.nextId : state.chunk?.prevId;
  if (target === state.spreadPage && !boundaryChunkId) {
    if (direction > 0) markChunkRead(state.bookId, state.chunkId, { automatic: true }).catch(showError);
    return;
  }

  const text = $("text");
  state.pageTurning = true;
  text.classList.add(direction > 0 ? "turning-next" : "turning-prev");
  setTimeout(async () => {
    if (target !== state.spreadPage) {
      state.spreadPage = target;
      renderText();
      saveReadingPosition({ immediate: true });
      return;
    }
    try {
      if (direction > 0) {
        await markChunkRead(state.bookId, state.chunkId, { automatic: true });
      }
      await selectChunk(boundaryChunkId);
      requestAnimationFrame(() => {
        updatePageTurner({ reset: true });
        if (direction < 0) {
          state.spreadPage = Math.max(0, state.spreadPages - 1);
          renderText();
        }
      });
    } catch (error) {
      showError(error);
    }
  }, 245);
  setTimeout(() => {
    text.classList.remove("turning-next", "turning-prev");
    state.pageTurning = false;
  }, 620);
}

function showSpreadAnnotation(noteId) {
  if (!isBookSpreadLayout()) return;
  const note = state.annotations.find((item) => item.id === noteId);
  const mark = document.querySelector(`mark[data-note-id="${CSS.escape(noteId)}"]`);
  if (!note || !mark) return;

  const notes = state.annotations.filter((item) => item.chunkId === note.chunkId);
  const replies = repliesFor(note.id, notes);
  const popover = spreadPopover();
  popover.classList.remove("mine-note", "partner-note", "neutral-note");
  popover.classList.add(`${annotationTone(note.author)}-note`);
  popover.innerHTML = `
    <button type="button" class="spread-note-close" data-close-spread-note aria-label="关闭批注">×</button>
    <p class="inline-note-kicker">${escapeHtml(formatIdentity(note.author))} · ${escapeHtml(note.kind || "note")}</p>
    <p class="spread-note-quote">${escapeHtml(note.quote || "")}</p>
    <p class="note-body">${escapeHtml(note.note || "")}</p>
    ${replies.length ? `<div class="spread-note-replies">${replies.map((reply) => renderReply(reply, note, notes, 1, new Set([note.id]))).join("")}</div>` : ""}
  `;
  popover.hidden = false;

  requestAnimationFrame(() => {
    const markRect = mark.getBoundingClientRect();
    const cardRect = popover.getBoundingClientRect();
    const margin = 18;
    const left = Math.min(
      window.innerWidth - cardRect.width - margin,
      Math.max(margin, markRect.left + markRect.width / 2 - cardRect.width / 2),
    );
    const below = markRect.bottom + 12;
    const top = below + cardRect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, markRect.top - cardRect.height - 12);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  });
}

function bindMarkActions() {
  document.querySelectorAll("mark[data-note-id]").forEach((mark) => {
    mark.tabIndex = 0;
    mark.setAttribute("role", "button");
    mark.setAttribute("aria-label", "打开或收起这条批注");
    mark.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleAnnotation(mark.dataset.noteId, { scroll: true });
    });
  });
}

function renderAnnotations() {
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const roots = notes.filter((item) => !item.parentId);
  const openCount = state.annotations.filter((item) => item.author === "user" && (item.status || "open") === "open")
    .length;

  $("margins").innerHTML = roots
    .map((note) => {
      const replies = replyCount(note.id, notes);
      const expanded = note.id === state.activeAnnotationId;
      const isShared = sharedNoteIdSet(notes).has(note.id);
      const canDelete = note.author === "user" && ["open", "private", "draft"].includes(note.status || "open");
      return `<article class="note-card ${annotationTone(note.author)}-note ${(note.status || "") === "open" ? "open" : ""} ${expanded ? "active" : ""}" data-note-id="${escapeHtml(note.id)}" tabindex="0">
        ${canDelete ? `<button class="note-delete" type="button" data-delete-note="${escapeHtml(note.id)}">删除</button>` : ""}
        ${isShared ? `<p class="shared-line">这里有两个人的折痕。</p>` : ""}
        <p class="note-quote">${escapeHtml(note.quote)}</p>
        <p class="note-body">${escapeHtml(note.note)}</p>
        <div class="note-meta">${escapeHtml(formatIdentity(note.author))} · ${escapeHtml(note.kind || "note")} · ${escapeHtml(note.status || "published")}${replies ? ` · ${replies} replies` : ""}</div>
        ${
          expanded
            ? renderThread(note, notes)
            : ""
        }
      </article>`;
    })
    .join("");

  $("submit-notes").disabled = openCount === 0;
  $("submit-notes").textContent = openCount ? `发送 ${openCount} 条给${partnerName()}` : `发送给${partnerName()}`;
  $("status").textContent = openCount
    ? `${openCount} 条私人笔记正在等待发送。`
    : "你的笔记会先安静地留在这里。";
  $("tools-count").textContent = String(openCount);
  $("tools-count").hidden = openCount === 0;
  if (!$("library-notes")?.hidden) renderLibraryNotes();
}

function setReadingTools(open) {
  $("reading-tools").classList.toggle("is-open", open);
  $("reading-tools").setAttribute("aria-hidden", String(!open));
  $("tools-toggle").setAttribute("aria-expanded", String(open));
  $("tools-toggle").classList.toggle("is-hidden", open);
}

function currentBook() {
  return state.books.find((item) => item.bookId === state.bookId) || {};
}

function currentChunkMeta() {
  return state.chunks.find((item) => item.id === state.chunkId) || state.chunk?.chunk || {};
}

function refreshCards({ finish = null, show = false } = {}) {
  const chunkAnnotations = state.annotations.filter((item) => item.chunkId === state.chunkId);
  state.cardCandidates = buildCardCandidates({
    book: currentBook(),
    chunk: { ...currentChunkMeta(), text: state.chunk?.text || "" },
    annotations: chunkAnnotations,
    finish,
  });
  if (state.cardIndex >= state.cardCandidates.length) state.cardIndex = 0;
  $("show-card").disabled = state.cardCandidates.length === 0;
  $("show-card").textContent = state.cardCandidates.length ? `Cards ${state.cardCandidates.length}` : "Cards";
  if (show && state.cardCandidates.length) {
    openCardPanel();
  } else {
    renderCardPanel();
  }
}

function renderCardPanel() {
  const card = pickCard(state.cardCandidates, state.cardIndex);
  $("card-panel").hidden = !card || $("card-panel").hidden;
  if (!card) {
    $("card-preview").innerHTML = "";
    return;
  }
  $("card-preview").innerHTML = renderReadingCard(card);
}

function seededRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function readingCardArt(card) {
  const random = seededRandom(card.artSeed || 1);
  if (card.art === "ripple") {
    const centers = [
      [25 + random() * 18, 20 + random() * 18],
      [58 + random() * 18, 48 + random() * 18],
      [22 + random() * 14, 72 + random() * 12],
    ];
    const circles = centers
      .flatMap(([cx, cy], groupIndex) =>
        Array.from({ length: groupIndex === 1 ? 4 : 3 }, (_, index) => {
          const radius = 8 + index * (6 + random() * 3) + random() * 2;
          const opacity = 0.035 + random() * 0.06;
          return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
        }),
      )
      .join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.36">${circles}</g></svg>`;
  }
  if (card.art === "stardust") {
    const dots = Array.from({ length: 64 }, () => {
      const cx = 7 + random() * 86;
      const cy = 8 + random() * 80;
      const radius = 0.08 + random() * 0.24;
      const opacity = 0.18 + random() * 0.42;
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
    }).join("");
    const bright = Array.from({ length: 7 }, () => {
      const cx = 12 + random() * 76;
      const cy = 12 + random() * 72;
      const opacity = 0.22 + random() * 0.26;
      return `<path d="M ${(cx - 0.9).toFixed(2)} ${cy.toFixed(2)} L ${(cx + 0.9).toFixed(2)} ${cy.toFixed(2)} M ${cx.toFixed(2)} ${(cy - 0.9).toFixed(2)} L ${cx.toFixed(2)} ${(cy + 0.9).toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
    }).join("");
    const lines = Array.from({ length: 5 }, () => {
      const x1 = 8 + random() * 84;
      const y1 = 10 + random() * 76;
      const x2 = x1 + (random() - 0.5) * 12;
      const y2 = y1 + (random() - 0.5) * 12;
      return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}" opacity="0.07" />`;
    }).join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="currentColor">${dots}</g><g fill="none" stroke="currentColor" stroke-width="0.14">${lines}${bright}</g></svg>`;
  }
  const lines = Array.from({ length: 14 }, () => {
    const x = 8 + random() * 84;
    const drift = (random() - 0.5) * 10;
    const opacity = 0.06 + random() * 0.14;
    return `<path d="M ${x.toFixed(2)} 3 C ${(x + drift).toFixed(2)} 30 ${(x - drift).toFixed(2)} 62 ${x.toFixed(2)} 97" opacity="${opacity.toFixed(3)}" />`;
  }).join("");
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.32">${lines}</g></svg>`;
}

function renderReadingCard(card) {
  const displayLabel = (label) => {
    if (["Claude", "Assistant"].includes(label)) return partnerName();
    if (["You", "Reader"].includes(label)) return readerName();
    return label;
  };
  return `<article class="ritual-card ${escapeHtml(card.variant)} art-${escapeHtml(card.art || "fold")} ${escapeHtml(cardSizeClass(card))}">
    <div class="card-art">${readingCardArt(card)}</div>
    <div class="card-content">
      <p class="card-kicker">${escapeHtml(card.kicker)}</p>
      <h3>${escapeHtml(card.title)}</h3>
      <p class="card-subtitle">${escapeHtml(card.subtitle)}</p>
      <blockquote>${escapeHtml(card.quote)}</blockquote>
      <div class="card-voices ${card.rightText ? "" : "single"}">
        <section>
          <span>${escapeHtml(displayLabel(card.leftLabel))}</span>
          <p>${escapeHtml(card.leftText)}</p>
        </section>
        ${
          card.rightText
            ? `<section>
                <span>${escapeHtml(displayLabel(card.rightLabel))}</span>
                <p>${escapeHtml(card.rightText)}</p>
              </section>`
            : ""
        }
      </div>
      <footer>${escapeHtml(card.footer)}</footer>
    </div>
  </article>`;
}

function cardSizeClass(card) {
  const totalLength = [card.quote, card.leftText, card.rightText, card.note]
    .filter(Boolean)
    .join("")
    .length;
  if (totalLength < 120) return "card-compact";
  if (totalLength > 360) return "card-tall";
  return "card-standard";
}

function openCardPanel() {
  if (!state.cardCandidates.length) return;
  $("card-panel").hidden = false;
  renderCardPanel();
}

function updateSelectionAction() {
  const selection = window.getSelection();
  const details = selectionDetails(selection);
  state.selectedQuote = details?.quote || "";
  state.selectedQuoteOffset = details?.quoteOffset ?? null;
  $("note-selection").disabled = !state.selectedQuote || !state.bookId || !state.chunkId;
}

function elementForNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(needle.length, 1);
  }
  return count;
}

function findOccurrence(haystack, needle, occurrence) {
  let index = -1;
  let from = 0;
  for (let current = 0; current <= occurrence; current += 1) {
    index = haystack.indexOf(needle, from);
    if (index === -1) return -1;
    from = index + Math.max(needle.length, 1);
  }
  return index;
}

function selectionDetails(selection) {
  if (!selection || selection.rangeCount === 0 || !state.chunk?.text) return null;
  const rawQuote = selection.toString();
  const quote = rawQuote.trim();
  if (!quote) return null;

  const range = selection.getRangeAt(0);
  const textEl = $("text");
  const startEl = elementForNode(range.startContainer);
  const endEl = elementForNode(range.endContainer);
  if (!startEl || !endEl) return null;
  if (!textEl.contains(range.commonAncestorContainer) || !textEl.contains(startEl) || !textEl.contains(endEl)) return null;
  if (startEl.closest(".inline-note, .shared-bookmark") || endEl.closest(".inline-note, .shared-bookmark")) return null;

  const page = startEl.closest(".book-page");
  const pageContent = startEl.closest(".book-page-content") || textEl;
  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(pageContent);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const pageStart = Number(page?.dataset.pageStart || 0);
  const leadingTrim = Math.max(0, rawQuote.indexOf(quote));
  const directOffset = pageStart + prefixRange.toString().length + leadingTrim;
  const occurrence = countOccurrences(prefixRange.toString(), quote);
  const fallbackOffset = findOccurrence(state.chunk.text, quote, occurrence);
  const quoteOffset = state.chunk.text.slice(directOffset, directOffset + quote.length) === quote
    ? directOffset
    : fallbackOffset;
  return {
    quote,
    quoteOffset: quoteOffset >= 0 ? quoteOffset : null,
  };
}

async function loadBooks() {
  state.books = await api("/api/books");
  renderBooks();
}

async function selectBook(bookId, { resume = true } = {}) {
  saveReadingPosition({ immediate: true });
  const [chunks, annotations, progress] = await Promise.all([
    api(`/api/books/${encodeURIComponent(bookId)}/chunks`),
    api(`/api/annotations?bookId=${encodeURIComponent(bookId)}`),
    resume ? api(`/api/progress?bookId=${encodeURIComponent(bookId)}`) : Promise.resolve(null),
  ]);
  state.bookId = bookId;
  state.chunkId = null;
  state.chunk = null;
  state.activeAnnotationId = null;
  state.replyDrafts = {};
  state.chunks = chunks;
  state.annotations = annotations;
  const book = state.books.find((item) => item.bookId === bookId);
  $("book-meta").textContent = book?.author || "未知作者";
  $("book-title").textContent = cleanBookTitle(book?.title || bookId);
  renderBooks();
  const position = progress?.readingPosition;
  if (position?.chunkId && state.chunks.some((chunk) => chunk.id === position.chunkId)) {
    await selectChunk(position.chunkId, { position });
    return;
  }
  $("chunk-file").textContent = "No chapter selected";
  $("chunk-title").textContent = "Open a chapter to start reading";
  $("text").innerHTML = `<p class="empty">选择一个章节。长按选中文字，就能给${escapeHtml(partnerName())}留下批注。</p>`;
  $("mark-read").disabled = true;
  $("continue-reading").disabled = false;
  document.body.classList.add("has-book");
  document.body.classList.remove("has-chunk");
  renderChunks();
  renderAnnotations();
  scrollToPanel(".chapters");
}

function clearBookSelection() {
  state.bookId = null;
  state.chunkId = null;
  state.chunk = null;
  state.annotations = [];
  state.chunks = [];
  state.activeAnnotationId = null;
  state.cardCandidates = [];
  state.replyDrafts = {};
  $("book-meta").textContent = "Choose a book";
  $("book-title").textContent = "Reading shelf";
  $("chunk-file").textContent = "No chapter selected";
  $("chunk-title").textContent = "Open a chapter to start reading";
  $("text").innerHTML = `<p class="empty">先选择一本书和章节。长按选中文字，就能给${escapeHtml(partnerName())}留下批注。</p>`;
  $("text").classList.remove("short-spread");
  $("mark-read").disabled = true;
  $("continue-reading").disabled = true;
  $("show-card").disabled = true;
  document.body.classList.remove("has-book", "has-chunk");
  renderChunks();
  renderAnnotations();
}

async function deleteBookFromShelf(bookId) {
  const book = state.books.find((item) => item.bookId === bookId);
  const label = book?.title || bookId;
  if (!confirm(`Delete "${label}" from this library?\n\nThe files and related notes will be archived under data/trash.`)) return;

  const result = await api(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  $("status").textContent = result.message || `Deleted ${label}.`;
  await loadBooks();
  if (state.bookId === bookId) clearBookSelection();
  renderBooks();
}

async function renameBookOnShelf(bookId) {
  const book = state.books.find((item) => item.bookId === bookId);
  if (!book) return;
  const currentTitle = cleanBookTitle(book.title || bookId);
  const entered = prompt("给这本书取一个新名字：", currentTitle);
  if (entered === null) return;
  const title = entered.replace(/\s+/g, " ").trim();
  if (!title || title === book.title) return;

  const updated = await api(`/api/books/${encodeURIComponent(bookId)}`, {
    method: "PATCH",
    body: { title },
  });
  book.title = updated.title;
  state.booksRenderSignature = "";
  state.libraryNotesRenderSignature = "";
  renderBooks();
  renderLibraryNotes();
  if (state.bookId === bookId) $("book-title").textContent = updated.title;
  $("status").textContent = `书名已改为《${updated.title}》。`;
}

async function selectChunk(chunkId, { position = null } = {}) {
  saveReadingPosition({ immediate: true });
  state.chunkId = chunkId;
  const hasPosition = position?.chunkId === chunkId;
  state.spreadPage = hasPosition && position.layout === "spread"
    ? Math.max(0, Number(position.spreadPage) || 0)
    : 0;
  state.pendingSpreadRatio = hasPosition && position.layout !== "spread"
    ? Math.max(0, Math.min(1, Number(position.scrollRatio) || 0))
    : null;
  state.activeAnnotationId = null;
  state.chunk = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks/${encodeURIComponent(chunkId)}`);
  state.chunkOpenedAt = Date.now();
  state.chapterHadReadingMotion = false;
  state.lastFinish = null;
  $("chunk-file").textContent = state.chunk.chunk.id;
  $("chunk-title").textContent = state.chunk.chunk.title;
  $("mark-read").disabled = Boolean(state.chunks.find((item) => item.id === chunkId)?.read);
  $("continue-reading").disabled = false;
  document.body.classList.add("has-chunk");
  renderChunks();
  renderText();
  renderAnnotations();
  refreshCards();
  requestAnimationFrame(() => updatePageTurner());
  scrollToPanel(".reader");
  if (position?.chunkId === chunkId) restoreScrollPosition(position);
  else saveReadingPosition();
}

async function markChunkRead(bookId, chunkId, { automatic = false } = {}) {
  if (!bookId || !chunkId) return null;
  const key = `${bookId}:${chunkId}`;
  const chunkMeta = state.bookId === bookId ? state.chunks.find((item) => item.id === chunkId) : null;
  if (chunkMeta?.read || state.autoMarkingChunks.has(key)) return null;

  state.autoMarkingChunks.add(key);
  try {
    const result = await api("/api/mark-read", {
      method: "POST",
      body: { bookId, chunkId },
    });
    if (chunkMeta) chunkMeta.read = true;
    if (state.bookId === bookId) {
      state.chunks = await api(`/api/books/${encodeURIComponent(bookId)}/chunks`);
      renderChunks();
    }
    await loadBooks();
    state.lastFinish = result.finish || null;
    if (state.bookId === bookId && state.chunkId === chunkId) {
      $("mark-read").disabled = true;
      if (automatic) $("status").textContent = "已读到本章末尾，自动标记为 read。";
      refreshCards({ finish: state.lastFinish, show: Boolean(state.lastFinish) });
    }
    return result;
  } finally {
    state.autoMarkingChunks.delete(key);
  }
}

function maybeAutoMarkScrolledChapter() {
  if (!state.chunk || isBookSpreadLayout() || !state.chapterHadReadingMotion) return;
  if (Date.now() - state.chunkOpenedAt < 1200) return;
  const chunkMeta = state.chunks.find((item) => item.id === state.chunkId);
  if (chunkMeta?.read) return;
  const rect = $("text").getBoundingClientRect();
  if (rect.bottom <= window.innerHeight + 72 && rect.top < window.innerHeight * 0.35) {
    markChunkRead(state.bookId, state.chunkId, { automatic: true }).catch(showError);
  }
}

function openNoteForm(quote) {
  state.quote = quote.trim();
  state.quoteOffset = state.selectedQuote === state.quote ? state.selectedQuoteOffset : null;
  if (!state.bookId || !state.chunkId || !state.quote) return;
  $("quote-preview").textContent = state.quote;
  $("note").value = "";
  $("note-form").hidden = false;
  $("note").focus();
}

function activateAnnotation(noteId, { scroll = false } = {}) {
  state.activeAnnotationId = noteId;
  renderText();
  renderAnnotations();
  if (isBookSpreadLayout()) showSpreadAnnotation(noteId);
  if (scroll) {
    document.querySelector(`.inline-note[data-note-id="${CSS.escape(noteId)}"], .note-card[data-note-id="${CSS.escape(noteId)}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

function toggleAnnotation(noteId, { scroll = false } = {}) {
  if (!isBookSpreadLayout() && state.activeAnnotationId === noteId) {
    state.activeAnnotationId = null;
    renderText();
    renderAnnotations();
    return;
  }
  activateAnnotation(noteId, { scroll });
}

async function deletePrivateNote(noteId) {
  const note = state.annotations.find((item) => item.id === noteId);
  if (!note) return;
  if (!confirm(`删除这条尚未发送的批注？\n\n${note.note || ""}`)) return;
  await api(`/api/annotations/${encodeURIComponent(noteId)}`, { method: "DELETE" });
  if (state.activeAnnotationId === noteId) state.activeAnnotationId = null;
  await refreshCurrent({ force: true });
  showToast("这条私人批注已删除");
}

function isEditingDraft() {
  const active = document.activeElement;
  return Boolean(
    state.composing ||
      active?.matches?.("textarea, input") ||
      active?.closest?.(".reply-form, .note-form"),
  );
}

async function refreshCurrent({ force = false } = {}) {
  if (state.refreshInFlight) return;
  if (!force && isEditingDraft()) return;
  state.refreshInFlight = true;
  try {
    await loadBooks();
    if (state.bookId) {
      if (!state.books.some((book) => book.bookId === state.bookId)) {
        clearBookSelection();
        $("status").textContent = "This book was deleted from the active library.";
        return;
      }
      state.chunks = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks`);
      state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(state.bookId)}`);
      renderBooks();
      renderChunks();
      renderText();
      renderAnnotations();
      refreshCards();
    }
  } finally {
    state.refreshInFlight = false;
  }
}

$("books").addEventListener("click", (event) => {
  const renameButton = event.target.closest("[data-rename-book]");
  if (renameButton) {
    renameBookOnShelf(renameButton.dataset.renameBook).catch(showError);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-book]");
  if (deleteButton) {
    deleteBookFromShelf(deleteButton.dataset.deleteBook).catch(showError);
    return;
  }
  const button = event.target.closest("[data-book]");
  if (button) selectBook(button.dataset.book).catch(showError);
});

$("chunks").addEventListener("click", (event) => {
  const button = event.target.closest("[data-chunk]");
  if (button) selectChunk(button.dataset.chunk).catch(showError);
});

$("open-library-notes").addEventListener("click", () => setLibraryNotes(true).catch(showError));
$("close-library-notes").addEventListener("click", () => setLibraryNotes(false).catch(showError));
$("library-note-search").addEventListener("input", (event) => {
  state.libraryNoteQuery = event.target.value;
  renderLibraryNotes();
});
$("library-note-book-filter").addEventListener("change", (event) => {
  state.libraryNoteBook = event.target.value;
  renderLibraryNotes();
  $("library-notes-list").scrollIntoView({ block: "start", behavior: "smooth" });
});
$("library-notes-list").addEventListener("click", async (event) => {
  const quoteToggle = event.target.closest("[data-toggle-library-quote]");
  if (quoteToggle) {
    const quoteId = quoteToggle.dataset.toggleLibraryQuote;
    const wrap = quoteToggle.closest(".passage-quote-wrap");
    const expanded = !wrap.classList.contains("expanded");
    wrap.classList.toggle("expanded", expanded);
    if (expanded) state.expandedLibraryQuotes.add(quoteId);
    else state.expandedLibraryQuotes.delete(quoteId);
    updateLibraryQuoteToggles();
    return;
  }
  const button = event.target.closest("[data-jump-book]");
  if (!button) return;
  await setLibraryNotes(false);
  await selectBook(button.dataset.jumpBook, { resume: false });
  await selectChunk(button.dataset.jumpChunk);
  activateAnnotation(button.dataset.jumpNote, { scroll: true });
});

$("library-notes-list").addEventListener("toggle", () => {
  requestAnimationFrame(updateLibraryQuoteToggles);
}, true);

$("text").addEventListener("mouseup", () => {
  updateSelectionAction();
});

$("text").addEventListener("touchend", () => {
  setTimeout(updateSelectionAction, 80);
});

$("text").addEventListener("touchstart", (event) => {
  if (!isBookSpreadLayout() || event.touches.length !== 1) return;
  state.spreadTouchX = event.touches[0].clientX;
}, { passive: true });

$("text").addEventListener("touchend", (event) => {
  if (!isBookSpreadLayout() || state.spreadTouchX === null || !event.changedTouches.length) return;
  const distance = event.changedTouches[0].clientX - state.spreadTouchX;
  state.spreadTouchX = null;
  if (Math.abs(distance) < 56 || window.getSelection()?.toString()) return;
  turnSpread(distance < 0 ? 1 : -1);
}, { passive: true });

$("text").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-note]");
  if (deleteButton) {
    event.stopPropagation();
    deletePrivateNote(deleteButton.dataset.deleteNote).catch(showError);
    return;
  }
  const mark = event.target.closest("mark[data-note-id]");
  if (mark) toggleAnnotation(mark.dataset.noteId, { scroll: true });
});

document.addEventListener("selectionchange", updateSelectionAction);

$("cancel-note").addEventListener("click", () => {
  $("note-form").hidden = true;
});

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = $("note").value.trim();
  if (!note) return;
  await api("/api/annotations", {
    method: "POST",
    body: {
      bookId: state.bookId,
      chunkId: state.chunkId,
      quote: state.quote,
      quoteOffset: state.quoteOffset,
      note,
      kind: "note",
    },
  });
  $("note-form").hidden = true;
  window.getSelection()?.removeAllRanges();
  updateSelectionAction();
  await refreshCurrent({ force: true });
});

$("note-selection").addEventListener("click", () => {
  const quote = state.selectedQuote || window.getSelection()?.toString() || "";
  openNoteForm(quote);
  if (quote) setReadingTools(false);
});

$("margins").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-note]");
  if (deleteButton) {
    event.stopPropagation();
    deletePrivateNote(deleteButton.dataset.deleteNote).catch(showError);
    return;
  }
  if (event.target.closest("textarea, button")) return;
  const card = event.target.closest(".note-card[data-note-id]");
  if (card) activateAnnotation(card.dataset.noteId);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".reply-form");
  if (!form) return;
  event.preventDefault();
  const textarea = form.querySelector("textarea");
  const note = textarea.value.trim();
  if (!note) return;
  await api("/api/replies", {
    method: "POST",
    body: {
      parentId: form.dataset.parentId,
      note,
      author: "user",
      kind: "reply",
    },
  });
  textarea.value = "";
  delete state.replyDrafts[form.dataset.parentId];
  await refreshCurrent({ force: true });
});

document.addEventListener("input", (event) => {
  const textarea = event.target.closest("textarea");
  const form = event.target.closest(".reply-form");
  if (!textarea || !form) return;
  state.replyDrafts[form.dataset.parentId] = textarea.value;
});

document.addEventListener("compositionstart", (event) => {
  if (!event.target.closest?.(".reply-form, .note-form, .partner-inbox-reply-form")) return;
  state.composing = true;
});

document.addEventListener("compositionend", (event) => {
  if (!event.target.closest?.(".reply-form, .note-form, .partner-inbox-reply-form")) return;
  state.composing = false;
});

$("submit-notes").addEventListener("click", async () => {
  const result = await api("/api/submit-notes", {
    method: "POST",
    body: {
      bookId: state.bookId,
      sessionId: "reader",
      contextMode: "chunk-once-per-session",
    },
  });
  await refreshCurrent({ force: true });
  $("status").textContent = result.submissionId
    ? `已把 ${result.count} 条笔记发送给${partnerName()}。`
    : result.message || "No private notes to share.";
  setReadingTools(false);
});

$("mark-read").addEventListener("click", async () => {
  const result = await markChunkRead(state.bookId, state.chunkId);
  if (!result) return;
  if (!state.lastFinish && state.cardCandidates.some((card) => card.source === "shared")) {
    showToast("收获了一枚回声书签");
  }
});

$("continue-reading").addEventListener("click", async () => {
  if (!state.bookId) return;
  const next = await api(`/api/continue?bookId=${encodeURIComponent(state.bookId)}`);
  const chunkId = next?.chunk?.chunk?.id || next?.chunk?.chunkId || next?.chunk?.id;
  if (!chunkId) {
    $("status").textContent = next?.message || "Nothing left to continue.";
    return;
  }
  await selectChunk(chunkId, { position: next.readingPosition || next.progress?.readingPosition || null });
});

$("refresh").addEventListener("click", () => refreshCurrent({ force: true }).catch(showError));

$("tools-toggle").addEventListener("click", () => setReadingTools(true));
$("tools-close").addEventListener("click", () => setReadingTools(false));

$("page-prev").addEventListener("click", () => turnSpread(-1));
$("page-next").addEventListener("click", () => turnSpread(1));

const readingScrollTarget = document.querySelector(".reader") || window;
const noteReadingMotion = () => {
  if (!state.chunk || isBookSpreadLayout()) return;
  state.chapterHadReadingMotion = true;
  maybeAutoMarkScrolledChapter();
  saveReadingPosition();
};
window.addEventListener("scroll", noteReadingMotion, { passive: true });
if (readingScrollTarget !== window) readingScrollTarget.addEventListener("scroll", noteReadingMotion, { passive: true });

window.addEventListener("resize", () => {
  requestAnimationFrame(() => updatePageTurner());
});

$("back-to-library").addEventListener("click", () => {
  saveReadingPosition({ immediate: true });
  document.body.classList.remove("has-book", "has-chunk");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("back-to-chapters").addEventListener("click", () => {
  saveReadingPosition({ immediate: true });
  document.body.classList.remove("has-chunk");
  document.body.classList.add("has-book");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("pagehide", () => saveReadingPosition({ immediate: true, keepalive: true }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveReadingPosition({ immediate: true, keepalive: true });
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("partner-inbox").hidden) setReplyInbox(false);
});

$("show-card").addEventListener("click", openCardPanel);

$("card-close").addEventListener("click", () => {
  $("card-panel").hidden = true;
});

$("card-random").addEventListener("click", () => {
  if (!state.cardCandidates.length) return;
  state.cardIndex = (state.cardIndex + 1) % state.cardCandidates.length;
  renderCardPanel();
});

$("import-book").addEventListener("click", () => {
  $("import-file").click();
});

$("import-file").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  $("import-book").disabled = true;
  try {
    const imported = [];
    for (const file of files) {
      $("status").textContent = `Importing ${file.name}...`;
      const manifest = await api("/api/import", {
        method: "POST",
        body: {
          filename: file.name,
          dataBase64: await fileToBase64(file),
        },
      });
      imported.push(manifest);
    }
    $("status").textContent = files.length === 1 ? `Imported ${files[0].name}.` : `Imported ${files.length} books.`;
    await loadBooks();
    renderBooks();
    if (imported.length === 1 && imported[0]?.bookId) {
      await selectBook(imported[0].bookId);
    }
  } catch (error) {
    showError(error);
  } finally {
    $("import-book").disabled = false;
    event.target.value = "";
  }
});

$("partner-inbox-toggle").addEventListener("click", () => {
  setReplyInbox($("partner-inbox").hidden);
});

$("partner-inbox-close").addEventListener("click", () => setReplyInbox(false));

$("partner-inbox-list").addEventListener("input", (event) => {
  const form = event.target.closest(".partner-inbox-reply-form");
  if (!form || !event.target.matches("textarea")) return;
  state.replyInboxDrafts[form.dataset.inboxParent] = event.target.value;
});

$("partner-inbox-list").addEventListener("click", (event) => {
  if (!event.target.closest("[data-inbox-more]")) return;
  state.replyInboxVisibleCount += 5;
  state.replyInboxSignature = "";
  renderReplyInbox();
});

$("partner-inbox-list").addEventListener("submit", async (event) => {
  const form = event.target.closest(".partner-inbox-reply-form");
  if (!form) return;
  event.preventDefault();
  const textarea = form.querySelector("textarea");
  const note = textarea.value.trim();
  if (!note) return;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await api("/api/replies", {
      method: "POST",
      body: { parentId: form.dataset.inboxParent, note, author: "user", kind: "reply" },
    });
    delete state.replyInboxDrafts[form.dataset.inboxParent];
    textarea.value = "";
    state.replyInboxSignature = "";
    await refreshCurrent({ force: true });
    await refreshReplyInbox({ announce: false });
    showToast(`已经从回信里回复${partnerName()}`);
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-open-theme-picker]").forEach((button) => {
  button.addEventListener("click", () => setThemePicker(true));
});
document.querySelectorAll("[data-close-theme-picker]").forEach((button) => {
  button.addEventListener("click", () => setThemePicker(false));
});
$("theme-picker")?.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-theme-choice]");
  if (!choice) return;
  applyTheme(choice.dataset.themeChoice);
  setThemePicker(false);
  showToast("书房已经换好新衣服了");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("theme-picker")?.hidden) setThemePicker(false);
});

$("open-settings").addEventListener("click", () => setSettingsPanel(true));
document.querySelectorAll("[data-close-settings], #settings-cancel").forEach((button) => {
  button.addEventListener("click", () => {
    if ($("settings-panel").dataset.required === "true") return;
    setSettingsPanel(false);
  });
});
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const config = await api("/api/config", {
      method: "PUT",
      body: {
        roomName: $("setting-room-name").value,
        readerName: $("setting-reader-name").value,
        partnerName: $("setting-partner-name").value,
        welcomeText: $("setting-welcome-text").value,
      },
    });
    applyRoomConfig(config);
    state.replyInboxSignature = "";
    state.libraryNotesRenderSignature = "";
    renderReplyInbox();
    renderLibraryNotes();
    renderAnnotations();
    setSettingsPanel(false);
    showToast("共读空间设置已保存");
  } catch (error) {
    showError(error);
  } finally {
    submitButton.disabled = false;
  }
});

function showError(error) {
  $("status").textContent = error.message || String(error);
}

function dismissSplash() {
  const splash = $("splash");
  if (!splash || splash.classList.contains("leaving")) return;
  const wait = Math.max(0, 900 - (performance.now() - splashStartedAt));
  setTimeout(() => {
    splash.classList.add("leaving");
    splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  }, wait);
}

applyTheme(document.documentElement.dataset.theme || "rabbit", { persist: false });
loadRoomConfig()
  .then(() => loadBooks())
  .then(() => refreshReplyInbox({ announce: false }))
  .catch(showError)
  .finally(dismissSplash);
setTimeout(dismissSplash, 8000);
setInterval(() => {
  if (document.hidden) return;
  refreshCurrent().catch(showError);
  refreshReplyInbox().catch((error) => console.warn("Could not refresh assistant replies", error));
}, 5000);

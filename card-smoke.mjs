import {
  buildCardCandidates,
  findSharedMoments,
  isAssistantAuthor,
  isLowSignalChunk,
  pickCard,
  sharedNoteIdSet,
} from "../public/card-logic.js";

if (!isAssistantAuthor("assistant") || !isAssistantAuthor("claude") || !isAssistantAuthor("ember")) {
  throw new Error("assistant author compatibility aliases are incomplete");
}

const sharedAnnotations = [
  {
    id: "assistant-1",
    bookId: "solaris",
    chunkId: "ch08",
    author: "assistant",
    kind: "resonance",
    quote: "这里有一扇窗，窗外是缓慢移动的海。",
    note: "这不是风景，是一个意识正在看向另一个意识。",
  },
  {
    id: "user-1",
    bookId: "solaris",
    chunkId: "ch08",
    author: "user",
    status: "submitted",
    kind: "note",
    quote: "窗外是缓慢移动的海",
    note: "我也觉得这句不是景物描写。",
  },
];

const moments = findSharedMoments(sharedAnnotations);
if (moments.length !== 1) {
  throw new Error("shared card logic did not detect overlapping human/assistant quotes");
}

const sharedIds = sharedNoteIdSet(sharedAnnotations);
if (!sharedIds.has("assistant-1") || !sharedIds.has("user-1")) {
  throw new Error("shared card logic did not mark both sides of a shared margin");
}

const sharedCards = buildCardCandidates({
  book: { title: "Solaris", author: "Stanislaw Lem" },
  chunk: { id: "ch08", title: "Harey", text: "A substantial chapter text that is not a table of contents." },
  annotations: sharedAnnotations,
});
if (!sharedCards.some((card) => card.kicker === "这里有两个人的折痕。" || card.kicker === "此处有回声。")) {
  throw new Error("shared card copy did not include the approved bookmark lines");
}

if (!sharedCards.every((card) => card.art && Number.isFinite(card.artSeed))) {
  throw new Error("shared cards did not include deterministic art metadata");
}

if (!pickCard(sharedCards, 1)) {
  throw new Error("pickCard did not return a card");
}

const lowSignal = { id: "copyright", title: "作者注", text: "短短的一段说明。" };
if (!isLowSignalChunk(lowSignal)) {
  throw new Error("low-signal chapter detector missed an author note");
}

const finishCards = buildCardCandidates({
  book: { title: "Solaris", author: "Stanislaw Lem" },
  chunk: lowSignal,
  annotations: [],
  finish: {
    annotationCount: 32,
    chunkCount: 43,
    celebration: {
      title: "Book finished, margins preserved.",
      line: "The book is closed, but the margins are still awake.",
      prompt: "Choose one annotation worth returning to later.",
    },
  },
});
if (finishCards.some((card) => card.source === "finish")) {
  throw new Error("finish card should not auto-generate for low-signal chunks");
}

console.log("card smoke ok");

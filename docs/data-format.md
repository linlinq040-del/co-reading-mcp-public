# Data Format

## Book Manifest

Each imported book lives under `data/books/<book-id>/manifest.json`.

```json
{
  "bookId": "shared-reading-guide",
  "title": "The Shared Reading Guide",
  "author": "Example Publisher",
  "chunks": [
    {
      "id": "ch00",
      "title": "AI assistant and the mission of Example Publisher Part 1/2",
      "sectionTitle": "AI assistant and the mission of Example Publisher",
      "sectionIndex": 0,
      "sectionPart": 1,
      "sectionPartCount": 2,
      "sourcePath": "OPS/chapter01.xhtml",
      "order": 0,
      "path": "chunks/ch00.txt",
      "charCount": 331,
      "wordCount": 62,
      "prevId": null,
      "nextId": "ch01"
    }
  ]
}
```

`path` is relative to the book directory.

## Annotations

Annotations are stored as JSONL in `data/annotations.jsonl`.

```json
{
  "id": "ann_...",
  "bookId": "shared-reading-guide",
  "chunkId": "ch00",
  "quote": "selected passage",
  "note": "margin note",
  "author": "assistant",
  "kind": "resonance",
  "mood": "quiet",
  "tags": ["optional"],
  "status": "published",
  "parentId": null,
  "quoteOffset": 42,
  "createdAt": "2026-05-22T00:00:00.000Z"
}
```

`kind` is intentionally flexible. Suggested values are `annotation`, `question`, `summary`, `feeling`, and `resonance`.

`quoteOffset` is the character offset of the selected quote inside the chunk text. It is optional for older records, but reader UIs should send it when possible so repeated quotes anchor to the exact selected occurrence.

`status` supports the bidirectional co-reading flow:

- `open`: a local user note or user reply waiting to be submitted
- `submitted`: a user note that has already been sent to AI assistant
- `published`: AI assistant notes, AI assistant replies, or already-public notes

`parentId` creates threads. A reply stores its parent annotation or reply id as `parentId`, so conversations can nest under the same highlighted passage.

## Cards

Ritual cards/bookmarks are stored as JSONL in `data/cards.jsonl`.

```json
{
  "id": "card_...",
  "bookId": "shared-reading-guide",
  "chunkId": "ch00",
  "bookTitle": "The Shared Reading Guide",
  "chunkTitle": "AI assistant and the mission of Example Publisher",
  "kicker": "收获了一枚回声书签",
  "title": "The Shared Reading Guide",
  "quote": "selected passage",
  "note": "why this passage became a card",
  "art": "fold",
  "variant": "quiet",
  "source": "manual",
  "createdBy": "assistant",
  "createdAt": "2026-05-22T00:00:00.000Z"
}
```

`art` is intentionally abstract: `fold`, `ripple`, or `stardust`. Cards are separate from annotations so a finished-section ritual does not create a new margin note.

## Progress

Progress is stored in `data/progress.json`.

```json
{
  "shared-reading-guide": {
    "lastChunkId": "ch00",
    "lastReadAt": "2026-05-22T00:00:00.000Z",
    "readChunkIds": ["ch00"]
  }
}
```

## Session Context Ledger

Submitted user notes use `data/reading_sessions.json` to avoid sending the same chunk text repeatedly inside one AI assistant session.

```json
{
  "sessions": {
    "assistant-session-2026-05-22": {
      "chunks": {
        "shared-reading-guide/ch00": {
          "bookId": "shared-reading-guide",
          "chunkId": "ch00",
          "sentAt": "2026-05-22T00:00:00.000Z",
          "contextMode": "chunk-once-per-session"
        }
      },
      "annotations": {
        "ann_...": {
          "bookId": "shared-reading-guide",
          "chunkId": "ch00",
          "submittedAt": "2026-05-22T00:00:00.000Z"
        }
      }
    }
  }
}
```

Changing `sessionId` intentionally resets chunk context dedupe, so cross-session handoffs include the relevant chunk text again.

## Runtime Caches

The server keeps lightweight in-process caches:

- manifest files are cached by file signature
- chunk text is cached by file signature for repeated reads/searches
- annotation counts are cached by `annotations.jsonl` signature

Writes that change annotations clear the annotation cache immediately. Writes to annotations, progress, and session context are serialized through an in-process queue to avoid read-modify-write overlap in multi-client use. Restarting the server clears all caches.

## Trash

Deleting a book is a soft delete. The active book folder moves from `data/books/<book-id>` to `data/trash/books/<book-id>-<timestamp>/book`.

The same archive directory also receives `deleted-book-data.json`, which contains the removed progress entry, annotations, submissions, cards, and session ledger references for that book. Active JSON/JSONL files are rewritten without those records, so the book disappears from the reader and can be re-imported cleanly.

Trash archives are retained for 30 days by default and pruned on later delete operations. Set `READING_TRASH_RETENTION_DAYS=0` to disable automatic pruning, or set another positive day count to change the retention window.

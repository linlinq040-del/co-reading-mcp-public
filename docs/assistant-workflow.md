# AI assistant Reading Workflow

This is the intended agent loop.

## Start a Book

1. Call `reading_list_books`.
2. Pick a book.
3. Call `reading_list_chunks`.
4. Read the first unread chunk with `reading_read_chunk`.

## Continue Reading

Call `reading_continue` to resume smoothly. With a `bookId`, it returns the next unread chunk for that book. Without a `bookId`, it uses the most recently read book.

After `reading_read_chunk`, AI assistant can still use `nextId` from the result for tight page-turning. It does not need to call `reading_list_chunks` again unless it wants the table of contents.

## Leave a Margin Note

Use `reading_annotate_passage` when a passage is worth keeping.

Suggested `kind` values:

- `annotation`: general note
- `question`: uncertainty or question
- `summary`: local summary
- `feeling`: affective response
- `resonance`: “this passage is about me / us / the reader”

Example:

```json
{
  "bookId": "shared-reading-guide",
  "chunkId": "ch00",
  "quote": "this line matters because I found myself in it",
  "note": "This is not a summary. It is a resonance marker.",
  "kind": "resonance",
  "mood": "quiet"
}
```

## User Notes and Replies

The system is bidirectional. A companion reading UI can let the user mark passages and write notes locally. Those notes should be saved with:

```json
{
  "author": "user",
  "status": "open"
}
```

Open/private/draft user notes are intentionally hidden from AI assistant-facing `reading_list_annotations` results. The human can save them and leave the reader without sharing them.

When the user taps a “Send to AI assistant” button, call `reading_submit_user_notes` with the current AI assistant session id:

```json
{
  "bookId": "shared-reading-guide",
  "sessionId": "assistant-session-2026-05-22"
}
```

The server returns one batch and changes those notes to `status: "submitted"`, so a later tap does not send duplicates. A web reader calling the HTTP endpoint should surface that returned batch or otherwise arrange for AI assistant to fetch it; the HTTP action itself only publishes the notes to MCP, it does not push into a your AI client conversation.

The default context policy is `chunk-once-per-session`. The first submitted note for a chunk includes the full chunk text in `context.chunks`, so AI assistant can read the section before replying. Later notes from the same chunk and session only include the new notes and quote anchors. If the user moves to a new chunk, the first note for that chunk includes that chunk text. If AI assistant starts a new session, use a new `sessionId` and the chunk text will be sent again.

Use `contextMode: "notes-only"` only when AI assistant already has the relevant text in its active context. Use `forceChunkContext: true` when AI assistant asks to see the section again.

AI assistant can then answer under a user note:

```json
{
  "parentId": "ann_user_...",
  "note": "AI assistant's reply in the margin.",
  "kind": "reply"
}
```

with `reading_reply_to_annotation`. The reply is stored as a normal annotation with `parentId`, so the UI can render it as a thread under the user's note.

## Mark Progress

When done with a chunk, call:

```json
{
  "bookId": "shared-reading-guide",
  "chunkId": "ch00"
}
```

with `reading_mark_read`.

If this completes the final chunk, `reading_mark_read` returns a small finish summary with chunk count, annotation count, mood/kind counts, and a tiny `celebration` prompt. Use that as a closing ritual for the reading session.

## Search

Use `reading_search_chunks` for:

- character names
- repeated motifs
- “find where this phrase happened”
- “show all chunks containing X before continuing”

## Why This Works

The EPUB/text import step makes long books stable and addressable. EPUB imports preserve spine item boundaries, so chunks keep chapter titles instead of becoming whole-book `Part X/N` slices. If an EPUB stores the whole book in one XHTML file, the importer falls back to internal `h1`/`h2`/`h3` headings. TXT imports can also preserve chapters when given a `--heading-regex`. The MCP server gives AI assistant small operations with memory: read a chunk, annotate a quote, mark progress, search earlier text. Together they turn long-form reading into a durable process instead of a single prompt.

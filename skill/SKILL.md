---
name: feishu
description: Create and edit things in the user's Feishu / Lark cloud workspace — Bitable databases (多维表格), documents, spreadsheets, wiki pages, drive files, and messages. Use whenever the user asks to put something into 飞书/Feishu/Lark, to build a 多维表格 or database there, to write a Feishu doc, or to send a Feishu message.
---

# Feishu (飞书 / Lark)

The `feishu_*` tools act on a real Feishu tenant. New objects land in the
**authorized user's own drive**, which is usually what "put it in my Feishu"
means. If nobody has authorized yet, the tools fall back to the app identity and
say so in a warning — read that warning, because the object then lives somewhere
the user cannot see.

## Start here

Before the first Feishu write in a session, if anything is unclear about access,
run:

```
feishu_auth  { action: "status" }
```

It reports whether the app credentials resolve, whether a tenant token can be
minted, whether a user grant is stored, and which scopes are recommended.

**If it says the app is not configured, do not try to fix it yourself.** Tell the
user to open **设置 → 飞书 / Feishu** and fill in the App ID and App Secret there;
that page also shows the redirect URL to register and the scopes to grant, and it
stores the secret in the credential store rather than in a file. Do not ask them
to hand-edit YAML.

If it says no user grant is stored, run `{ action: "authorize_url" }` and give the
user the returned link — or tell them to press **授权飞书** on that settings page.

## The one workflow worth memorising: a 多维表格

```
feishu_bitable {
  action: "create_app",
  name: "2026 内容排期",
  tables: [{
    name: "排期",
    fields: [
      { name: "标题",   type: "text" },
      { name: "状态",   type: "single_select", options: ["待写", "撰写中", "已发布"] },
      { name: "负责人", type: "user" },
      { name: "发布日期", type: "date" }
    ]
  }]
}
```

Report the returned `url` — that is the link the user opens. Keep
`data.app_token` and `data.tables[0].table_id` for follow-up calls.

Then fill it:

```
feishu_bitable {
  action: "insert_records",
  appToken: "bascn...",
  tableId: "tbl...",
  records: [ { "标题": "第一篇", "状态": "待写" } ]
}
```

Records are written as plain objects keyed by field name. On update, add
`recordId` to each entry. Field values must match the field type: a
`single_select` takes one of its option names, a `user` takes a human-readable
value the API resolves, a `date` takes a timestamp in milliseconds.

## Choosing the right tool

| The user wants | Use |
|---|---|
| A database / table / 多维表格 / 表格化 | `feishu_bitable` |
| A document, a write-up, notes, a report as a doc | `feishu_doc` |
| A spreadsheet with rows and columns and formulas | `feishu_sheet` |
| A file kept in the cloud, or browsing what is there | `feishu_drive` |
| A page in a team knowledge base | `feishu_wiki` |
| A notification, a card, sending a file to someone | `feishu_message` |
| Something the tools above do not cover | `feishu_api` |

Bitable vs Sheet: if the user will filter, group, or relate rows, or says
多维表格, use Bitable. If they want a grid of numbers to calculate with, use a
spreadsheet.

## Writing a document

```
feishu_doc { action: "create", title: "周报", folderToken: "fldcn..." }
feishu_doc {
  action: "append_markdown",
  documentId: "doxcn...",
  markdown: "# 本周

- 完成 A
- 进行 B

| 项 | 状态 |
| --- | --- |
| A | 完成 |"
}
```

`append_markdown` converts headings, lists, tables, code blocks, and quotes into
native Feishu blocks. Prefer it over `append_blocks` unless you need a block
type the converter does not produce.

If the content already exists as a local file, `import_file` is better: Feishu
converts Markdown, Word, Excel, PowerPoint, and PDF server-side at full
fidelity. It needs a destination `folderToken`.

## Working with an existing wiki or doc

A wiki URL token is not a document token. Resolve it first:

```
feishu_wiki { action: "get_node", nodeToken: "wikcn..." }
```

The reply carries `obj_token` and `obj_type`; feed `obj_token` to
`feishu_doc` or `feishu_bitable` as appropriate.

## When something fails

Errors are written to be acted on. Read the `hint:` line before retrying.

| Symptom | What it means |
|---|---|
| `code: 99991672`, "missing scopes" listed | The Feishu app is missing an API scope. It must be added in the developer console **and a new version published** — adding the scope alone does nothing. |
| `code: 99991668` | The user grant expired and could not be refreshed. Re-authorize. |
| A warning about acting as the app | No user is authorized, so the object landed in the app's space. Authorize to put it in the user's drive. |
| `record id` errors | Updates need `recordId`; inserts must not carry one. |
| A field-name error on a Bitable write | List the fields first with `action: "list_fields"` — names must match exactly, including case and spacing. |

Never retry a permission failure unchanged; it will fail identically. Fix the
scope or the authorization, or switch `identity` to `"app"` if the app genuinely
should own the object.

## Using the escape hatch well

`feishu_api` takes `method`, `path`, `query`, and `body`:

```
feishu_api { method: "GET", path: "/contact/v3/users/ou_xxx", query: { user_id_type: "open_id" } }
```

Paths are relative to the open-apis base and must start with `/`. The response
envelope is unwrapped, so you get the `data` object directly. Reach for it for
calendars, tasks, approvals, and anything else the curated tools do not model —
but prefer a curated tool when one exists, because it validates arguments and
explains failures better.

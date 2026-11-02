# Device tool contract (protocol 1)

The tools the [PopCraft extension for Nihmbus](https://github.com/nihmbus/nihmbus-popcraft) declares (its
`nihmbus.extension.json`) and this plugin implements ([`main.js`](../main.js)). The two copies of this file must
match below this paragraph. The relay itself (pairing, polling, uploads) is Nihmbus core: see
[extension devices](https://github.com/nihmbus/nihmbus/blob/main/docs/extension-devices.md).

Both sides send `X-Nihmbus-Extension-Protocol: 1`. Change a tool incompatibly → bump the extension's `device.protocol` and this
plugin's `EXTENSION_PROTOCOL` together, and release both.

## `status`

Arguments: none.

Result:

```json
{
  "plugin": { "id": "popcraft.nihmbus", "version": "0.1.0", "protocol": 1 },
  "page": { "id": "…", "name": "Page 1", "childIds": ["…"] },
  "selection": [{ "id": "…", "name": "Poster", "type": "FRAME" }]
}
```

## `call`

Arguments: either `{ method, args? }` or `{ calls: [{ method, args? }, …] }` (1–50, run in order, stopping at the first
error). `method` is one of the PopCraft plugin API methods listed in the manifest's enum. `args` is the method's
**positional** argument list, exactly as the [plugin API reference](https://popcraft.app/docs/plugins/api-reference)
shows it (`["FRAME", { "name": "Poster" }]` for `createNode(type, props)`, `[{ … }]` for the object-style motion
methods).

Result: `{ "results": [<the method's return value>, …] }`, one entry per call. A failed call fails the whole command
with that method's error message and the index it stopped at: `call 3 (setKeyframes): …`.

Excluded on purpose (not in the enum, and refused by the plugin): anything that opens UI or new documents, reads or
writes plugin storage or file data, opens links, uploads, reads or sets site environment variables, imports from URLs
on the user's behalf (`addAudio`, `importDocumentFile`, `setPresentationAudioClip`), spends AI credits
(`requestPresentationAudio`), and `exportNode` (use `export`).

## `export`

Arguments: `{ nodeId, format?: "PNG"|"JPG"|"WEBP"|"SVG"|"PDF" (PNG), scale?: 0.1–8 (1), filename? }`.

The plugin renders the layer with `exportNode`, asks Nihmbus for a presigned upload URL, uploads the file with the
plugin `upload` API (≤ 500 MB), and reports it.

Result: `{ "exported": { "nodeId": "…", "format": "PNG", "bytes": 12345 } }` plus one file, which the agent receives as
`{ name, contentType, size, url }`.

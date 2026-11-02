# Nihmbus for PopCraft

A [PopCraft](https://popcraft.app) plugin that connects your PopCraft editor to [Nihmbus](https://nihmbus.ai), so your
Nihmbus agents can design, animate and export in it: on popcraft.app or in the desktop app.

```
Nihmbus agent ──▶ Nihmbus ◀── long-poll ── this plugin, in your PopCraft editor
```

Every connection goes **out** from the plugin to Nihmbus: it asks for work, runs it with the PopCraft plugin API, and
sends back the result. Nothing listens on your machine, so it works in a browser tab and in the sandboxed App Store
app alike.

- **This repo** is the PopCraft side.
- **[nihmbus/nihmbus-popcraft](https://github.com/nihmbus/nihmbus-popcraft)** is the Nihmbus side: the extension that
  gives agents the PopCraft tools and skills.
- The relay is a general Nihmbus feature,
  [extension devices](https://github.com/nihmbus/nihmbus/blob/main/docs/extension-devices.md).

## Use it

1. In Nihmbus, install the **PopCraft** extension, then open **Extensions → PopCraft → Connect PopCraft**. It shows
   a code.
2. In PopCraft, install this plugin (main menu → **Manage plugins…** → search **Nihmbus**, or **Installed → Install
   from file…** with a release `.json`), then run **Plugins → Nihmbus → Connect** and enter the code.
3. Leave it running while agents work. **Hide panel** keeps it connected; closing the panel, the PopCraft tab or the
   app disconnects. Run **Connect** again to reconnect: no new code needed.
4. **Disconnect** (here or in Nihmbus) stops it for good.

What agents can do: see what's open (`status`), run [plugin API](https://popcraft.app/docs/plugins/api-reference)
methods on the open file (`call`), and export layers as PNG, JPG, WEBP, SVG or PDF (`export`). See
[docs/tools.md](docs/tools.md).

## Permissions

| | Why |
|---|---|
| `read`, `write` | Agents build and edit designs in the open file. |
| `export` | Agents export layers. |
| `network` | The plugin talks to Nihmbus and uploads exports to the storage URL Nihmbus gives it. |

Only methods on an allowlist can run (the same list the extension declares); anything that opens UI, reads plugin
storage, opens links or uploads elsewhere is refused. The connection token is kept in this plugin's private storage
on your device and is only ever sent to the Nihmbus server you connected to. Agents only see the result of each call.

## Develop

```sh
npm test                                              # the connector against a mock PopCraft and relay
npm run pack                                          # dist/popcraft.nihmbus-<version>.json, installable from file
node scripts/contract-check.mjs ../nihmbus-popcraft/nihmbus.extension.json   # matches the extension's tool contract
```

- [`main.js`](main.js): the connector (pairing, polling, the tools). It's a plain script, as PopCraft loads it; the
  logic is a `createConnector(deps)` factory, so the tests run it in Node.
- [`ui.html`](ui.html): the panel.
- [`docs/tools.md`](docs/tools.md): the tool contract, shared with the extension. A breaking change bumps
  `EXTENSION_PROTOCOL` here and `device.protocol` in the extension, together.
- For a Nihmbus server other than nihmbus.ai (development, self-hosting), use **Use a different server** in the panel.
  It must be `https://`, or `http://localhost`.

## License

[MIT](LICENSE)

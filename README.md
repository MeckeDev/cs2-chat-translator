# CS2 Chat Translator

Translate Counter-Strike 2 chat messages in real time using simple in-game commands like `tm_de`, `_tl`, and `code_french`, while keeping in-game chat clean and readable. The tool reads your `console.log`, translates messages via Google Translate, and sends responses back into the game using a configurable keybind.

> **Note:** CS2 must be started with the Steam launch option `-condebug` so that `console.log` is actually written. See “Enable console logging (`-condebug`)" below.

---

## Features

* **In-game translation commands**

  * `tm_<lang> TEXT`
    Translate arbitrary text to `<lang>` and send it to chat.
    Example: `tm_de hello friends`
  * `_tl [lang]`
    Translate the **last normal chat message** to `[lang]` (default: `en`) and send it to chat.
  * `code_<language>`
    Fuzzy search for language names and show the matching `tm_<code>` helper.
    Example: `code_french` → `For French use tm_fr`

* **Automatic console translation**

  * All non-command messages are automatically translated to a target language (default: English) in the **terminal only**.
  * Does *not* spam the in-game chat.

* **Config-based setup**

  * User config stored under:

    * Linux: `~/.config/cs2-chat-translator/config.json`
  * CLI helpers to initialize and adjust config (log path, cfg directory, bind key).

* **No owner logic, no blacklist**

  * This edition focuses purely on:

    * `tm_`
    * `_tl`
    * `code_`
    * auto-translate to console
   
*  **Clean GUI**
  * The tool now starts a HTTP server that allows you to open the Chat in a clean GUI in your Browser
  * <img width="1094" height="1001" alt="grafik" src="https://github.com/user-attachments/assets/41e52a26-f599-4a11-b94c-f3de760ef4f2" /><br/>
    <img width="424" height="761" alt="grafik" src="https://github.com/user-attachments/assets/171036f2-d416-4990-a733-ef783f84e52a" /><br/>
    <img width="531" height="508" alt="grafik" src="https://github.com/user-attachments/assets/7e091b66-11a8-46fe-ba95-0f15a3b91cf1" /><br/>



---

## How It Works

1. CS2 writes chat lines into `console.log` (via `-condebug`).
2. The tool tails `console.log` and parses lines like:

   * `[CT] PlayerName: message`
   * `[T] PlayerName: message`
   * `[ALL] PlayerName: message`
3. Depending on the content:

   * Commands (`tm_`, `_tl`, `code_`) trigger translations and responses via in-game chat.
   * All other lines (non-command messages) are translated to a target language and printed in the terminal.
4. Responses to be sent to CS2 are written into `chat_reader.cfg` and executed via a bind key using `xdotool`.

---

## Requirements

* **OS:** Linux (tested with CS2 under Steam/Proton)
* **Runtime:**

  * Node.js 18+ (ESM + modern `fs` APIs)
  * `xdotool` (to simulate the keypress that executes `chat_reader.cfg`)
* **Network:** Internet connection (for Google Translate)
* **Game:** Counter-Strike 2 with console logging enabled via `-condebug`

---

## Enable Console Logging (`-condebug`)

CS2 must be told to write the console output to `console.log`. This is **critical**; without it, the tool has nothing to read.

1. Open **Steam**.
2. Go to **Library → Right click on Counter-Strike 2 → Properties…**.
3. Under **Launch Options**, add:

   ```text
   -condebug
   ```
4. Start CS2 once so that `console.log` gets created.

The file is typically located in something like:

```text
~/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/console.log
```

(You can override the exact path in the config.)

---

## Installation

### AUR (Arch-based distributions)

If you are on Arch Linux or a derivative (e.g. EndeavourOS, CachyOS, Manjaro) and the package is available in the AUR:

```bash
yay -S cs2-chat-translator
# or
paru -S cs2-chat-translator
```

This will:

* Install the tool under `/usr/lib/cs2-chat-translator`
* Expose the CLI as `cs2-chat-translator` in your `$PATH`

### From Source (generic)

Clone the repository:

```bash
git clone https://github.com/MeckeDev/cs2-chat-translator.git
cd cs2-chat-translator
```

Install dependencies:

```bash
npm install
```

Make sure the main CLI file is executable:

```bash
chmod +x bin/cs2-chat-translator.js
```

You can now run it directly:

```bash
node bin/cs2-chat-translator.js
```

Or link it globally via `npm link` (optional):

```bash
npm link
cs2-chat-translator --help
```

---

## Configuration

The tool uses a simple JSON config file:

* **Linux:** `~/.config/cs2-chat-translator/config.json`

Example content:

```json
{
  "logPath": "/home/youruser/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/console.log",
  "cfgDir": "/home/youruser/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg",
  "bindKey": "l"
}
```

### CLI helpers

The CLI provides some helper flags to create and edit the config without manually opening the file:

* Initialize or refresh config with sane defaults:

  ```bash
  cs2-chat-translator --init-config
  ```

* Set the path to `console.log`:

  ```bash
  cs2-chat-translator --set-log-path /full/path/to/console.log
  ```

* Set the CS2 `cfg` directory:

  ```bash
  cs2-chat-translator --set-cfg-dir /full/path/to/csgo/cfg
  ```

* Change the bind key (the key used in CS2 to execute `chat_reader.cfg`):

  ```bash
  cs2-chat-translator --set-bind-key l
  ```

These commands will update `~/.config/cs2-chat-translator/config.json`. You can still fine-tune it manually if needed.

---

## CS2 Setup

### 1. Enable console logging

As described above, add `-condebug` to your CS2 Steam launch options and start the game once.

### 2. Find your `cfg` directory

Typical path under Linux with Steam/Proton:

```text
~/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg
```

Use this as `cfgDir` in the config.

### 3. Bind a key to execute `chat_reader.cfg`

In your CS2 `cfg` folder, you will have your own configuration files like `autoexec.cfg`. Add a line similar to:

```text
bind l "exec chat_reader.cfg"
```

Replace `l` with whatever key you configured as `bindKey` in `config.json`.

The tool will write its output into `chat_reader.cfg`, and pressing the bound key will cause CS2 to send the corresponding chat message.

---

## Usage

### Start the translator

Once configured:

```bash
cs2-chat-translator --init-config    # first time, optional but recommended
cs2-chat-translator
```

You should see something like:

```text
🚀 CS2 Chat Translator (watching console.log)

Commands:
  • tm_<lang> TEXT      → translate TEXT to <lang> (chat output, e.g., tm_de hello)
  • _tl [lang]          → translate last message to [lang] (default en)
  • code_<langname>     → show helper like 'For French use tm_fr'

Auto-Translate:
  • Non-commands → shown in console as '<from> → EN'
```

Keep this terminal window open while you play CS2.

### In-game commands

All commands are typed directly into the CS2 chat.

#### `tm_<lang> TEXT`

Translate arbitrary text into the target language and send it to chat.

* Example:

  * `tm_de hello friends`
* Output in chat (example):

  * `YourName said - Hallo Freunde - (from English)`

Supported languages are based on Google Translate’s language codes (e.g. `en`, `de`, `fr`, `es`, `ru`, `pt`, `zh_cn`, `zh_tw`, …).

#### `_tl [lang]`

Translate the **last normal chat message**.

* If `lang` is omitted, defaults to `en`.
* Example:

  * Someone writes in Russian: `Привет, как дела?`
  * In console you see auto-translation.
  * You type: `_tl de`
* Output in chat (example):

  * `TheirName said - Wie geht es dir? - (from Russian)`

The tool keeps track of the last non-command, non-empty message for `_tl`.

#### `code_<language>`

Helps you find the correct `tm_<code>` for a human-readable language name using fuzzy matching.

* Examples:

  * `code_french` → `For French use tm_fr`
  * `code brasil` → likely `For Portuguese use tm_pt`
  * `code simplified chinese` → might suggest `tm_zh_cn`

This is useful when you don’t remember the exact language code.

---

## Automatic Console Translation

All normal chat messages (that are **not** commands) are automatically translated to a target language (default: English) and printed in the terminal.

Example console output:

```text
🌍 [T] Player123 (Russian → EN): Hello, how are you?
```

This allows you to see what’s going on without spamming the in-game chat.

---

## Troubleshooting

### “console.log not found”

If you see an error like:

```text
❌ console.log not found: /path/to/console.log
```

Check:

1. CS2 is launched with `-condebug`.
2. The `logPath` in `config.json` is correct.
3. The file actually exists and is being updated while you play.

You can fix the path via:

```bash
cs2-chat-translator --set-log-path /correct/path/to/console.log
```

### `xdotool` errors

If you see messages like:

```text
xdotool error: ...
```

Ensure:

* `xdotool` is installed:

  ```bash
  sudo pacman -S xdotool    # Arch
  ```
* The window focus is on CS2 when the script triggers.
* The `bindKey` in your config matches the bind in your CS2 cfg.

### Translations fail or are wrong

* Google Translate may throttle or change behavior.
* Cyrillic text has a heuristic to prefer Russian (`ru`) if detection seems off.
* If `smartTranslate` fails, the original text may be returned without changes.

---

## Development

Install dev dependencies and run from the repo:

```bash
git clone https://github.com/MeckeDev/cs2-chat-translator.git
cd cs2-chat-translator
npm install
node bin/cs2-chat-translator.js --init-config
node bin/cs2-chat-translator.js
```

You can edit the source, adjust behavior, and keep using the same config file. Contributions and forks are welcome as long as the license terms are respected.

---

## License

This project is open source. See the `LICENSE` file in the repository for full details.

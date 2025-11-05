#!/usr/bin/env node
/**
 * CS2 Chat Translator (CLI)
 * =========================
 *
 * What this tool does
 * -------------------
 * - Watches your CS2 console.log file in real time.
 * - Parses chat messages like: "[CT] Player: message".
 * - Supports a minimal, focused command set typed directly in CS2 chat:
 *
 *   1) tm_<lang> TEXT
 *        - Example: "tm_de hello friend"
 *        - Translates TEXT into <lang> and sends the result to in-game chat.
 *        - Output format: "<sender> said - <translation> - (from <original language>)"
 *
 *   2) _tl [lang]
 *        - Example: "_tl de"
 *        - Translates the last normal chat message (not a command) into [lang].
 *        - Defaults to English ("en") if no language is provided.
 *        - Also sends the translation to in-game chat.
 *
 *   3) code_<language name>
 *        - Example: "code_french", "code chinese", "code brasil"
 *        - Fuzzy search on language names and aliases.
 *        - Responds in chat with a hint: "For French use tm_fr".
 *
 *   4) Auto-Translate to console only
 *        - Every non-command chat message is auto-translated to a target language
 *          (default "en") and printed in the terminal.
 *        - This **does not** send anything back to the game, so the in-game chat stays clean.
 *
 * Design goals
 * ------------
 * - Keep the in-game chat free of colors/emojis and other formatting.
 * - Use rich, colored output in the terminal for better debugging and visibility.
 * - Be easy to fork and extend:
 *     - Configuration is stored in a simple JSON file.
 *     - Logic is clearly separated into modules/sections.
 *
 * Runtime dependencies
 * --------------------
 * - nodejs (tested on Node.js 18+)
 * - xdotool (used to press the bind key that executes a CFG file inside CS2)
 * - google-translate-api-x (translation)
 * - chalk (colored terminal output)
 * - fuzzball (fuzzy language name matching for code_<...> command)
 *
 * Configuration
 * -------------
 * The tool stores its configuration in:
 *   - Linux:
 *       - $XDG_CONFIG_HOME/cs2-chat-translator/config.json
 *         or
 *       - ~/.config/cs2-chat-translator/config.json
 *
 * Example config.json:
 *   {
 *     "logPath": "/path/to/console.log",
 *     "cfgDir": "/path/to/cfg",
 *     "bindKey": "l"
 *   }
 *
 * CLI interface
 * -------------
 *   cs2-chat-translator                 # Start watching console.log and translating
 *   cs2-chat-translator --init-config   # Initialize or refresh config.json with defaults
 *   cs2-chat-translator --set-log-path /path/to/console.log
 *   cs2-chat-translator --set-cfg-dir  /path/to/cfg
 *   cs2-chat-translator --set-bind-key l
 *
 * In-game setup (CS2)
 * -------------------
 * 1) Make sure console logging is enabled:
 *      launchoption -condebug
 * 2) Bind a key to execute a CFG which we will overwrite:
 *      bind l "exec chat_reader.cfg"
 * 3) Set up config.json for this tool so it knows where:
 *      - console.log is located
 *      - the cfg directory is located
 *      - which key is bound
 * 4) Run the tool while CS2 is running:
 *      cs2-chat-translator
 *
 * Then, whenever the tool writes into chat_reader.cfg, it triggers xdotool
 * to press the configured key, and CS2 executes the "say" / "say_team" command.
 */

import fs from "fs";
import readline from "readline";
import { exec as execChild } from "child_process";
import translate from "google-translate-api-x";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import chalk from "chalk";
import * as fuzz from "fuzzball";

// -----------------------------------------------------------------------------
// File / path utilities and configuration handling
// -----------------------------------------------------------------------------

// ESM equivalents of __filename and __dirname for people used to CommonJS.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global variables that are populated from config at runtime.
let LOG_PATH = "";
let CSGO_CFG_DIR = "";
let CHAT_CFG = "";
let BIND_KEY = "l";

// Location of the config directory and config file.
// On Linux we follow the XDG spec as far as possible.
const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, "cs2-chat-translator")
  : path.join(os.homedir(), ".config", "cs2-chat-translator");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// A "best guess" path for CS2 console.log on typical Steam/Proton setups.
// This is only a default and can be overridden via config or CLI.
const guessedRoot = path.join(
  os.homedir(),
  ".local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo"
);

const defaultConfig = {
  logPath: path.join(guessedRoot, "console.log"),
  cfgDir: path.join(guessedRoot, "cfg"),
  bindKey: "l"
};

/**
 * Load configuration from CONFIG_PATH.
 * If the file does not exist or is invalid, fall back to defaultConfig.
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...defaultConfig };
    }
    const txt = fs.readFileSync(CONFIG_PATH, "utf8").trim();
    if (!txt) return { ...defaultConfig };
    const cfg = JSON.parse(txt);
    return {
      logPath: cfg.logPath || defaultConfig.logPath,
      cfgDir: cfg.cfgDir || defaultConfig.cfgDir,
      bindKey: cfg.bindKey || defaultConfig.bindKey
    };
  } catch (err) {
    console.error(chalk.red(`Failed to load config: ${err.message}`));
    return { ...defaultConfig };
  }
}

/**
 * Save configuration to CONFIG_PATH, merging with defaults first.
 * This ensures the structure stays consistent across versions.
 */
function saveConfig(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const merged = {
      logPath: cfg.logPath || defaultConfig.logPath,
      cfgDir: cfg.cfgDir || defaultConfig.cfgDir,
      bindKey: cfg.bindKey || defaultConfig.bindKey
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  } catch (err) {
    console.error(chalk.red(`Failed to write config: ${err.message}`));
    process.exit(1);
  }
}

/**
 * CLI helper: initialize or refresh the config file on disk.
 * This is idempotent: calling it multiple times just updates missing fields.
 */
function initConfigCli() {
  const merged = saveConfig(loadConfig());
  console.log(chalk.green("Config initialized/updated:"));
  console.log(`  ${CONFIG_PATH}`);
  console.log("Effective values:");
  console.log(`  logPath: ${merged.logPath}`);
  console.log(`  cfgDir : ${merged.cfgDir}`);
  console.log(`  bindKey: ${merged.bindKey}`);
}

/**
 * CLI helper: update a single key in the config file, keeping everything else.
 */
function updateConfigKey(key, value) {
  const cfg = loadConfig();
  cfg[key] = value;
  const merged = saveConfig(cfg);
  console.log(chalk.green(`Config updated (${key}):`));
  console.log(`  ${CONFIG_PATH}`);
  console.log(`  ${key}: ${merged[key]}`);
}

/**
 * After we have a config in memory, set up global variables that depend on it.
 * - LOG_PATH: path to console.log
 * - CSGO_CFG_DIR: directory containing chat_reader.cfg
 * - CHAT_CFG: full path to chat_reader.cfg (overwritten on each message)
 * - BIND_KEY: key that CS2 binds to "exec chat_reader.cfg"
 */
function setupFromConfig() {
  const cfg = loadConfig();
  LOG_PATH = cfg.logPath;
  CSGO_CFG_DIR = cfg.cfgDir;
  BIND_KEY = cfg.bindKey || "l";
  CHAT_CFG = path.join(CSGO_CFG_DIR, "chat_reader.cfg");

  if (!LOG_PATH) {
    console.error(chalk.red("No logPath configured."));
    console.error(`Edit ${CONFIG_PATH} or use --set-log-path.`);
    process.exit(1);
  }
  if (!CSGO_CFG_DIR) {
    console.error(chalk.red("No cfgDir configured."));
    console.error(`Edit ${CONFIG_PATH} or use --set-cfg-dir.`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Console styling utilities
// -----------------------------------------------------------------------------

/**
 * Emoji and color mappings used in terminal output.
 * These are intentionally NOT used for in-game chat messages.
 */
const sym = {
  start: chalk.cyan("🚀"),
  info: chalk.cyan("ℹ️"),
  ok: chalk.green("✅"),
  warn: chalk.yellow("⚠️"),
  err: chalk.red("❌"),
  chat: chalk.magenta("💬"),
  trans: chalk.blueBright("🌍"),
  cfg: chalk.white("📝")
};

function log(prefix, msg) {
  console.log(prefix, msg);
}

function logKV(key, value) {
  console.log(chalk.gray(`   ${key}:`), chalk.white(value));
}

// -----------------------------------------------------------------------------
// Language mapping and auto-translate configuration
// -----------------------------------------------------------------------------

/**
 * Short ISO language codes mapped to human-readable names.
 * This is used for console logs and fuzzy matching in the code_<...> command.
 */
const LANG_MAP = {
  af:"Afrikaans", sq:"Albanian", am:"Amharic", ar:"Arabic", hy:"Armenian",
  az:"Azerbaijani", eu:"Basque", be:"Belarusian", bn:"Bengali", bs:"Bosnian",
  bg:"Bulgarian", ca:"Catalan", ceb:"Cebuano", ny:"Chichewa", zh:"Chinese",
  zh_cn:"Chinese (Simplified)", zh_tw:"Chinese (Traditional)", co:"Corsican",
  hr:"Croatian", cs:"Czech", da:"Danish", nl:"Dutch", en:"English",
  eo:"Esperanto", et:"Estonian", tl:"Filipino", fi:"Finnish", fr:"French",
  fy:"Frisian", gl:"Galician", ka:"Georgian", de:"German", el:"Greek",
  gu:"Gujarati", ht:"Haitian Creole", ha:"Hausa", haw:"Hawaiian", he:"Hebrew",
  hi:"Hindi", hmn:"Hmong", hu:"Hungarian", is:"Icelandic", ig:"Igbo",
  id:"Indonesian", ga:"Irish", it:"Italian", ja:"Japanese", jw:"Javanese",
  kn:"Kannada", kk:"Kazakh", km:"Khmer", rw:"Kinyarwanda", ko:"Korean",
  ku:"Kurdish (Kurmanji)", ky:"Kyrgyz", lo:"Lao", la:"Latin", lv:"Latvian",
  lt:"Lithuanian", lb:"Luxembourgish", mk:"Macedonian", mg:"Malagasy",
  ms:"Malay", ml:"Malayalam", mt:"Maltese", mi:"Maori", mr:"Marathi",
  mn:"Mongolian", my:"Myanmar (Burmese)", ne:"Nepali", no:"Norwegian",
  or:"Odia (Oriya)", ps:"Pashto", fa:"Persian", pl:"Polish", pt:"Portuguese",
  pa:"Punjabi", ro:"Romanian", ru:"Russian", sm:"Samoan", gd:"Scots Gaelic",
  sr:"Serbian", st:"Sesotho", sn:"Shona", sd:"Sindhi", si:"Sinhala",
  sk:"Slovak", sl:"Slovenian", so:"Somali", es:"Spanish", su:"Sundanese",
  sw:"Swahili", sv:"Swedish", tg:"Tajik", ta:"Tamil", tt:"Tatar", te:"Telugu",
  th:"Thai", tr:"Turkish", tk:"Turkmen", uk:"Ukrainian", ur:"Urdu",
  ug:"Uyghur", uz:"Uzbek", vi:"Vietnamese", cy:"Welsh", xh:"Xhosa",
  yi:"Yiddish", yo:"Yoruba", zu:"Zulu"
};

/**
 * Auto-translate configuration.
 * - AUTO_TRANSLATE: master switch
 * - AUTO_TRANSLATE_TARGET: language code for console output
 */
const AUTO_TRANSLATE = true;
const AUTO_TRANSLATE_TARGET = "en";

/**
 * Heuristic: Russian is often mis-detected for mixed Cyrillic text.
 * We allow an override:
 * - If the source contains Cyrillic characters AND detection says "not ru"
 *   AND this flag is true, we try a second translation pass forcing "from: ru".
 */
const PREFER_RU_FOR_CYRILLIC = true;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;

// -----------------------------------------------------------------------------
// Low-level helpers: CFG writing and key press simulation
// -----------------------------------------------------------------------------

/**
 * Escape characters that would break CS2's CFG "say" syntax:
 * - backslashes
 * - double quotes
 */
function escapeForCfg(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Write a single "say" or "say_team" command into chat_reader.cfg
 * and log the action for debugging.
 */
function writeChatCfg({ message, team = false }) {
  const safe = escapeForCfg(message);
  const cmd = team ? `say_team "${safe}"` : `say "${safe}"`;
  fs.writeFileSync(
    CHAT_CFG,
    `// Auto-generated by CS2 Chat Translator\n${cmd}\n`,
    "utf8"
  );
  log(sym.cfg, `Wrote to cfg: ${team ? "say_team" : "say"} → ${message}`);
}

/**
 * Fire xdotool with the configured BIND_KEY to trigger the in-game bind.
 * This is the bridge between the Node process and CS2.
 */
function pressBindKey() {
  execChild(`xdotool key ${BIND_KEY}`, (err) => {
    if (err) log(sym.warn, chalk.yellow(`xdotool error: ${err.message}`));
  });
}

/**
 * Human-readable language name helper for console logs.
 */
function langName(iso) {
  const key = (iso || "").toLowerCase();
  return LANG_MAP[key] || key.toUpperCase() || "UNKNOWN";
}

// -----------------------------------------------------------------------------
// Translation logic (smartTranslate + helpers)
// -----------------------------------------------------------------------------

/**
 * smartTranslate(text, toLang)
 * ----------------------------
 * Wraps google-translate-api-x with:
 * - Automatic language detection by default.
 * - Optional Russian override for Cyrillic-heavy text.
 * - Safe error handling (returns a stub if translation fails).
 */
async function smartTranslate(text, toLang = "en") {
  try {
    let res = await translate(text, { to: toLang });
    const guess = (res.from?.language?.iso || "").toLowerCase();

    const shouldForceRu =
      PREFER_RU_FOR_CYRILLIC && CYRILLIC_REGEX.test(text) && guess !== "ru";

    if (shouldForceRu) {
      try {
        const forced = await translate(text, { from: "ru", to: toLang });
        forced.__forcedFrom = "ru";
        return forced;
      } catch {
        // If forcing Russian fails for any reason, just fall back to the
        // original detection result without crashing the process.
      }
    }
    return res;
  } catch (err) {
    log(sym.warn, chalk.yellow(`Translation failed: ${err.message}`));
    return { text, from: { language: { iso: "unknown" } } };
  }
}

/**
 * Extracts a readable "original language" label from the translation response.
 * Respects forced Russian override if it was applied.
 */
function originalLangReadable(res) {
  const iso = (res.__forcedFrom || res.from?.language?.iso || "unknown").toLowerCase();
  return langName(iso);
}

// -----------------------------------------------------------------------------
// code_<language name> command (language helper)
// -----------------------------------------------------------------------------

/**
 * Normalize input queries for fuzzy matching:
 * - lowercase
 * - collapse separators (underscore/dash) into spaces
 * - drop parentheses
 * - collapse multiple spaces
 */
function normalizeQueryLoose(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a list of candidate languages with several aliases per code.
 * This allows matching both ISO codes and human names.
 */
function buildLangCandidates() {
  const entries = Object.entries(LANG_MAP).map(([code, name]) => {
    const base = name;
    const bare = name.replace(/\s*\([^)]*\)\s*/g, "").trim();
    const aliases = new Set([
      base.toLowerCase(),
      bare.toLowerCase(),
      code.toLowerCase()
    ]);

    // Some extra aliases for common mistakes and shorter forms.
    if (code === "zh_cn") { aliases.add("simplified chinese"); aliases.add("chinese simplified"); }
    if (code === "zh_tw") { aliases.add("traditional chinese"); aliases.add("chinese traditional"); }
    if (code === "ga")    { aliases.add("irish gaelic"); }
    if (code === "gd")    { aliases.add("scottish gaelic"); aliases.add("scots gaelic"); }
    if (code === "jw")    { aliases.add("javanese"); }
    if (code === "my")    { aliases.add("burmese"); }
    if (code === "tl")    { aliases.add("tagalog"); }
    if (code === "pt")    { aliases.add("brazilian portuguese"); aliases.add("brasilianisch"); }
    if (code === "he")    { aliases.add("ivrit"); }

    return { code, name: base, aliases: Array.from(aliases) };
  });
  return entries;
}

/**
 * Find the best language match for a free-form query using fuzzball.
 * Returns either { code, name, score } or null if no reasonable match exists.
 */
function bestLangMatch(query) {
  const q = normalizeQueryLoose(query);
  if (!q) return null;
  const candidates = buildLangCandidates();

  // Fast path: exact alias match.
  for (const c of candidates) {
    if (c.aliases.some((a) => a === q)) return { code: c.code, name: c.name, score: 100 };
  }

  // Fuzzy scoring per candidate: we consider max score across all aliases.
  let best = null;
  for (const c of candidates) {
    const score = Math.max(...c.aliases.map((a) => fuzz.ratio(q, a)));
    if (!best || score > best.score) best = { code: c.code, name: c.name, score };
  }

  // Apply a basic threshold to avoid nonsense matches.
  return best && best.score >= 55 ? best : null;
}

/**
 * Handle code_<language> command.
 * Example inputs:
 *   code_french
 *   code french
 *   code brasil
 *
 * The output is always a short helper string sent to in-game chat, like:
 *   "For French use tm_fr"
 */
function handleCodeLang({ isTeam, message }) {
  const m = message.match(/^code[_\s]+(.+)$/i);
  if (!m) return false;
  const query = m[1].trim();
  if (!query) return true;

  const match = bestLangMatch(query);
  if (match) {
    const reply = `For ${match.name} use tm_${match.code}`;
    writeChatCfg({ message: reply, team: isTeam });
    setTimeout(pressBindKey, 150);
    log(sym.info, chalk.cyan(`code → ${reply} (score ${match.score})`));
  } else {
    const reply =
      `No close language match for "${query}". Try tm_en, tm_de, tm_fr, tm_es, tm_ru, tm_pt...`;
    writeChatCfg({ message: reply, team: isTeam });
    setTimeout(pressBindKey, 150);
    log(sym.warn, chalk.yellow(reply));
  }
  return true;
}

// -----------------------------------------------------------------------------
// Commands: tm_ (inline translation) and _tl (last-message translation)
// -----------------------------------------------------------------------------

// Memory for the last "normal" chat message, used by _tl.
let lastForeignMsg = null;

/**
 * tm_<lang> TEXT
 * --------------
 * Translate the supplied TEXT into <lang> and send it to in-game chat.
 * - Handles both team and global chat (say / say_team).
 * - Logs the action to the console for debugging and transparency.
 */
async function handleTm({ isTeam, sender, message }) {
  if (!/^tm_[a-z_]{2,5}\b/i.test(message)) return false;

  const [cmd, ...rest] = message.split(" ");
  const lang = cmd.slice(3).toLowerCase();
  const text = rest.join(" ").trim();
  if (!text) return true;

  const res = await smartTranslate(text, lang);
  const translated = res.text;
  const originalLang = originalLangReadable(res);

  const output = `${sender} said - ${translated} - (from ${originalLang})`;
  writeChatCfg({ message: output, team: isTeam });
  setTimeout(pressBindKey, 150);

  log(sym.trans, chalk.blueBright(`tm_${lang} → sent to chat`));
  logKV("from", originalLang);
  logKV("text", translated);
  return true;
}

/**
 * _tl [lang]
 * ----------
 * Translate the last non-command, non-empty chat message into [lang]
 * and send the result to in-game chat.
 * - If no language is provided, defaults to English ("en").
 * - If no last message is stored, it informs the user instead of failing silently.
 */
async function handleTl({ isTeam, message }) {
  if (!/^_tl\b/i.test(message)) return false;

  if (!lastForeignMsg) {
    const msg = "No recent message to translate.";
    writeChatCfg({ message: msg, team: isTeam });
    setTimeout(pressBindKey, 150);
    log(sym.warn, chalk.yellow(msg));
    return true;
  }

  const parts = message.split(" ");
  const target = parts[1]?.toLowerCase() || "en";

  const res = await smartTranslate(lastForeignMsg.message, target);
  const translated = res.text;
  const originalLang = originalLangReadable(res);
  const output = `${lastForeignMsg.player} said - ${translated} - (from ${originalLang})`;

  writeChatCfg({ message: output, team: isTeam });
  setTimeout(pressBindKey, 150);

  log(sym.trans, chalk.blueBright(`_tl → ${target}`));
  logKV("from", originalLang);
  logKV("player", lastForeignMsg.player);
  logKV("text", translated);
  return true;
}

// -----------------------------------------------------------------------------
// Auto-translate to console only (no in-game chat output)
// -----------------------------------------------------------------------------

/**
 * Auto-translate all non-command messages to a target language and print
 * the result to the terminal.
 * This keeps your in-game chat clean while giving you context in your console.
 */
async function autoTranslateToConsole({ team, sender, message }) {
  if (!AUTO_TRANSLATE) return;
  if (!message) return;

  // Skip known commands.
  if (/^(_tl\b|tm_[a-z_]{2,5}\b|code[_\s])/i.test(message)) return;
  // Skip "dummy" messages that contain only dots or whitespace.
  if (/^[.\s]+$/.test(message)) return;

  const res = await smartTranslate(message, AUTO_TRANSLATE_TARGET);
  const fromIso = (res.__forcedFrom || res.from?.language?.iso || "unknown").toLowerCase();

  if (fromIso !== AUTO_TRANSLATE_TARGET.toLowerCase()) {
    const readableLang = langName(fromIso);
    console.log(
      sym.trans,
      chalk.blueBright(
        `[${team}] ${sender} (${readableLang} → ${AUTO_TRANSLATE_TARGET.toUpperCase()}): `
      ) + chalk.gray(res.text)
    );
  }
}

// -----------------------------------------------------------------------------
// Log line parsing and high-level line handler
// -----------------------------------------------------------------------------

/**
 * handleLine(line)
 * ----------------
 * Parse a single console.log line and run it through:
 *   1) Command detection & handling
 *   2) Auto-translate for normal messages
 *
 * Expected format for chat lines:
 *   "10/26 18:49:20  [CT] Player: hello"
 *   "10/26 18:49:20  [ALL] Some Guy: tm_de hello"
 */
async function handleLine(line) {
  const match = line.match(/\[(CT|T|ALL)\]\s+([^:]+):\s(.+)/);
  if (!match) return;

  const [, team, player, messageRaw] = match;
  const message = (messageRaw || "").trim();
  const sender = (player || "").trim();
  const isTeam = team === "CT" || team === "T";

  // Pretty console logging of the raw chat line.
  log(
    sym.chat,
    chalk.magentaBright(`[${team}] `) +
      chalk.bold(sender) +
      chalk.white(": ") +
      chalk.white(message)
  );

  // Track the last "normal" message (no command, not just punctuation) for _tl.
  if (
    !/^tm_[a-z_]{2,5}\b|^_tl\b|^code[_\s]/i.test(message) &&
    !/^[.\s]+$/.test(message)
  ) {
    lastForeignMsg = { player: sender, message, team };
  }

  // Command handling order:
  // 1) _tl
  // 2) code_<lang>
  // 3) tm_<lang>
  // 4) auto-translate to console
  if (await handleTl({ isTeam, message })) return;
  if (handleCodeLang({ isTeam, message })) return;
  if (await handleTm({ isTeam, sender, message })) return;

  await autoTranslateToConsole({ team, sender, message });
}

// -----------------------------------------------------------------------------
// CLI front-end and startup logic
// -----------------------------------------------------------------------------

/**
 * Print human-readable CLI help. This is invoked when:
 * - cs2-chat-translator --help
 * - cs2-chat-translator -h
 */
function printCliHelp() {
  console.log("CS2 Chat Translator");
  console.log("");
  console.log("Usage:");
  console.log("  cs2-chat-translator                 # start watching console.log");
  console.log("  cs2-chat-translator --init-config   # create/refresh config.json");
  console.log("  cs2-chat-translator --set-log-path /path/to/console.log");
  console.log("  cs2-chat-translator --set-cfg-dir  /path/to/cfg");
  console.log("  cs2-chat-translator --set-bind-key l");
  console.log("");
  console.log("In-game commands:");
  console.log("  tm_<lang> TEXT    → translate TEXT to <lang> (e.g. tm_de hello)");
  console.log("  _tl [lang]        → translate last message to [lang] (default en)");
  console.log("  code_<language>   → show helper like 'For French use tm_fr'");
}

/**
 * Start the tailing loop and print an initial banner with summary of features.
 */
async function start() {
  setupFromConfig();

  if (!fs.existsSync(LOG_PATH)) {
    console.error(chalk.red(`❌ console.log not found: ${LOG_PATH}`));
    console.error("Ensure CS2 is running and logging to this file.");
    process.exit(1);
  }
  if (!fs.existsSync(CSGO_CFG_DIR)) {
    console.error(chalk.red(`❌ cfg directory not found: ${CSGO_CFG_DIR}`));
    process.exit(1);
  }

  console.log(
    sym.start,
    chalk.bold(`CS2 Chat Translator (watching console.log)\n`)
  );
  console.log(chalk.gray("Commands:"));
  console.log(
    chalk.white(
      "  • tm_<lang> TEXT      → translate TEXT to <lang> (chat output, e.g., tm_de hello)"
    )
  );
  console.log(
    chalk.white(
      "  • _tl [lang]          → translate last message to [lang] (default en)"
    )
  );
  console.log(
    chalk.white(
      "  • code_<language>     → show helper like 'For French use tm_fr'\n"
    )
  );
  console.log(chalk.gray("Auto-Translate:"));
  console.log(
    chalk.white(
      `  • Non-commands → shown in console as '<from> → ${AUTO_TRANSLATE_TARGET.toUpperCase()}'`
    )
  );
  console.log("");

  // Use fs.watchFile to efficiently read only the appended portion of console.log.
  fs.watchFile(LOG_PATH, { interval: 500 }, (curr, prev) => {
    if (curr.size <= prev.size) return;
    const stream = fs.createReadStream(LOG_PATH, {
      start: prev.size,
      end: curr.size,
      encoding: "utf8"
    });
    const rl = readline.createInterface({ input: stream });
    rl.on("line", (line) => {
      Promise.resolve(handleLine(line)).catch((err) =>
        console.error(chalk.red("Line handling error:"), err)
      );
    });
  });
}

// Parse CLI arguments and handle config commands before starting the watcher.
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printCliHelp();
  process.exit(0);
}

if (args[0] === "--init-config") {
  initConfigCli();
  process.exit(0);
}

if (args[0] === "--set-log-path" && args[1]) {
  updateConfigKey("logPath", path.resolve(args[1]));
  process.exit(0);
}

if (args[0] === "--set-cfg-dir" && args[1]) {
  updateConfigKey("cfgDir", path.resolve(args[1]));
  process.exit(0);
}

if (args[0] === "--set-bind-key" && args[1]) {
  updateConfigKey("bindKey", args[1]);
  process.exit(0);
}

// Default mode: start watching console.log and handling chat.
start().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, 'data');
export const CONFIG_PATH = path.join(__dirname, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = {};
const saveTimers = {};

export function loadFile(name, def = {}) {
  const p = path.join(DATA_DIR, name + '.json');
  if (cache[name] !== undefined) return cache[name];
  try {
    cache[name] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    cache[name] = def;
  }
  return cache[name];
}

export function saveFile(name, data) {
  const p = path.join(DATA_DIR, name + '.json');
  cache[name] = data;
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[Storage Error] Failed to write ${name}.json:`, e);
  }
}

export function saveFileDebounced(name, data, delayMs = 3000) {
  cache[name] = data;
  if (saveTimers[name]) clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => {
    saveFile(name, cache[name]);
    delete saveTimers[name];
  }, delayMs);
}

export function getGuildConfig(guildId) {
  const cfg = loadFile('guilds', {});
  if (!cfg[guildId]) cfg[guildId] = { logChannel: null, welcomeChannel: null, verifyChannel: null, verifyRole: null, autorole: null, ticketCategory: null, ticketCategories: [], supportRole: null, inviteCode: null, levelRewards: {}, trusted: [], raidMode: false, spamLimit: 5, spamWindow: 5000, warnMute: 3, warnBan: 5, filterWords: [] };
  return cfg[guildId];
}

export function saveGuildConfig(guildId) {
  const cfg = loadFile('guilds', {});
  saveFile('guilds', cfg);
}

export function getGuildStorage(guildId) {
  return loadFile('guild_' + guildId, { warns: {}, levels: {}, reactionRoles: {}, tickets: {}, backups: [], antinuke: { lastSnapshot: null } });
}

export function saveGuildStorage(guildId, immediate = false) {
  const st = loadFile('guild_' + guildId, {});
  if (immediate) {
    saveFile('guild_' + guildId, st);
  } else {
    saveFileDebounced('guild_' + guildId, st, 2000);
  }
}

export function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  return {
    token: process.env.DISCORD_TOKEN || process.env.TOKEN || fileConfig.token || '',
    ownerId: process.env.OWNER_ID || fileConfig.ownerId || '',
    guildId: process.env.GUILD_ID || fileConfig.guildId || ''
  };
}


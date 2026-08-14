import { EmbedBuilder, ChannelType, Colors, PermissionsBitField, AuditLogEvent } from 'discord.js';
import { getGuildConfig, getGuildStorage, saveGuildStorage, saveGuildConfig } from './storage.js';

export async function logEvent(guild, title, desc, color = Colors.Red) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.logChannel) return;
  const ch = guild.channels.cache.get(cfg.logChannel);
  if (!ch) return;
  try {
    await ch.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp()] });
  } catch {}
}

export function isTrusted(guild, userId) {
  const cfg = getGuildConfig(guild.id);
  if (guild.ownerId === userId || cfg.trusted.includes(userId)) return true;
  return false;
}

export function canManage(interaction) {
  const m = interaction.member;
  if (!m) return false;
  if (interaction.client.ownerId === m.id) return true;
  if (isTrusted(interaction.guild, m.id)) return true;
  return m.permissions.has(PermissionsBitField.Flags.Administrator);
}

/* ---------------- ANTI-NUKE ---------------- */

export function antiNukeTrack(guild, type) {
  const st = getGuildStorage(guild.id);
  if (!st.antinuke.events) st.antinuke.events = [];
  const now = Date.now();
  st.antinuke.events = st.antinuke.events.filter(e => now - e.t < 10000);
  st.antinuke.events.push({ type, t: now });
  const count = st.antinuke.events.filter(e => e.type === type).length;
  saveGuildStorage(guild.id);
  return count;
}

const THRESHOLD = { ban: 4, channel: 3, role: 3, kick: 4 };

export async function antiNukeCheck(guild, type, channelDeleteIds = []) {
  const count = antiNukeTrack(guild, type);
  if (count < THRESHOLD[type]) return;
  const cfg = getGuildConfig(guild.id);
  if (isTrusted(guild, guild.client?.user?.id)) return;
  const st = getGuildStorage(guild.id);
  if (st.antinuke.triggered && Date.now() - st.antinuke.triggered < 60000) return;
  st.antinuke.triggered = Date.now();
  saveGuildStorage(guild.id);

  let executor = null;
  try {
    const auditMap = { ban: AuditLogEvent.MemberBanAdd, channel: AuditLogEvent.ChannelDelete, role: AuditLogEvent.RoleDelete, kick: AuditLogEvent.MemberKick };
    const logs = await guild.fetchAuditLogs({ type: auditMap[type], limit: 10 });
    const recent = logs.entries.filter(e => Date.now() - e.createdTimestamp < 15000);
    const exec = recent.find(e => !e.targetId || !isTrusted(guild, e.targetId));
    if (exec) executor = exec.executor;
  } catch {}

  let act = 'Terjadi aktivitas mencurigakan';
  if (executor) {
    act = `Pelaku terdeteksi: <@${executor.id}>`;
    try { await guild.members.ban(executor.id, { reason: 'Auto-ban: aktivitas destruktif (anti-nuke)' }); act += ' — sudah di-ban otomatis.'; } catch {}
  }

  try {
    const backup = st.antinuke.lastSnapshot;
    if (backup && backup.channels.length) {
      for (const snap of backup.channels) {
        if (guild.channels.cache.has(snap.id)) continue;
        try {
          await guild.channels.create({ name: snap.name, type: snap.type, parent: snap.parentId || undefined, topic: snap.topic || undefined });
        } catch {}
      }
    }
    if (backup && backup.roles.length) {
      for (const snap of backup.roles) {
        if (guild.roles.cache.has(snap.id)) continue;
        try { await guild.roles.create({ name: snap.name, color: snap.color || undefined, hoist: !!snap.hoist, permissions: snap.permissions || [] }); } catch {}
      }
    }
  } catch {}

  await lockdown(guild, true);
  await logEvent(guild, '🚨 ANTI-NUKE TERPICU', `Tipe: **${type.toUpperCase()}** (${count}x dalam 10 detik)\n${act}\n\nServer di-**lockdown** otomatis. Periksa & pulihkan.\nUntuk membuka: \`/lockdown off\``, Colors.Red);
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) await owner.send(`🚨 **ANTI-NUKE** di server **${guild.name}**!\n${act}\nServer di-lockdown otomatis. Ketik \`/lockdown off\` untuk membuka kembali.`).catch(() => {});
  } catch {}
}

/* ---------------- LOCKDOWN ---------------- */

export async function lockdown(guild, state) {
  const cfg = getGuildConfig(guild.id);
  cfg.lockdown = state;
  saveGuildConfig(guild.id);
  let done = 0;
  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
      try {
        if (state) await ch.permissionOverwrites.create(guild.roles.everyone, { SendMessages: false });
        else await ch.permissionOverwrites.delete(guild.roles.everyone).catch(() => {});
        done++;
      } catch {}
    }
  }
  return done;
}

/* ---------------- ANTI-SPAM ---------------- */

const spam = new Map();

export function checkSpam(guildId, member, content) {
  const cfg = getGuildConfig(guildId);
  const now = Date.now();
  const st = getGuildStorage(guildId);
  if (!spam.has(member.id)) spam.set(member.id, []);
  const arr = spam.get(member.id).filter(t => now - t < cfg.spamWindow);
  arr.push(now);
  spam.set(member.id, arr);
  if (arr.length > cfg.spamLimit) {
    spam.set(member.id, []);
    return true;
  }
  const mentions = (content.match(/<@!?\d+>/g) || []).length;
  if (mentions >= 5) return true;
  return false;
}

/* ---------------- FILTER KATA ---------------- */

export function checkFilter(guildId, content) {
  const cfg = getGuildConfig(guildId);
  const low = content.toLowerCase();
  return (cfg.filterWords || []).filter(w => {
    const wordLow = w.toLowerCase();
    // For short words (<=4 chars like sex), use word boundary to avoid false positives on words like "sextet"
    if (wordLow.length <= 4) {
      const re = new RegExp(`\\b${wordLow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(low);
    }
    return low.includes(wordLow);
  });
}

/* ---------------- LEVELING ---------------- */

export const levelXp = lvl => 5 * lvl * lvl + 50 * lvl + 100;

export function xpForMessage(guild, member) {
  const cfg = getGuildConfig(guild.id);
  if (cfg.raidMode || member.user.bot) return null;
  const st = getGuildStorage(guild.id);
  const key = member.id;
  if (!st.levels[key]) st.levels[key] = { xp: 0, level: 0, lastMsg: 0 };
  const d = st.levels[key];
  if (Date.now() - d.lastMsg < 60000) return null;
  d.lastMsg = Date.now();
  d.xp += 15 + Math.floor(Math.random() * 11);
  const target = levelXp(d.level);
  if (d.xp >= target) {
    d.level++;
    d.xp -= target;
    saveGuildStorage(guild.id);
    const reward = cfg.levelRewards[d.level];
    if (reward) {
      const role = guild.roles.cache.get(reward);
      if (role && !member.roles.cache.has(role.id)) member.roles.add(role).catch(() => {});
    }
    return d.level;
  }
  saveGuildStorage(guild.id);
  return null;
}

/* ---------------- REACTION ROLES ---------------- */

export async function handleReactionAdd(reaction, user) {
  if (user.bot || !reaction.message.guild) return;
  const st = getGuildStorage(reaction.message.guild.id);
  const rr = (st.reactionRoles[reaction.message.id] || []).find(r => r.emoji === reaction.emoji.name || (reaction.emoji.id && r.emoji === reaction.emoji.id));
  if (!rr) return;
  const member = reaction.message.guild.members.cache.get(user.id);
  const role = reaction.message.guild.roles.cache.get(rr.role);
  if (member && role && !member.roles.cache.has(role.id)) member.roles.add(role).catch(() => {});
}

export async function handleReactionRemove(reaction, user) {
  if (user.bot || !reaction.message.guild) return;
  const st = getGuildStorage(reaction.message.guild.id);
  const rr = (st.reactionRoles[reaction.message.id] || []).find(r => r.emoji === reaction.emoji.name || (reaction.emoji.id && r.emoji === reaction.emoji.id));
  if (!rr) return;
  const member = reaction.message.guild.members.cache.get(user.id);
  const role = reaction.message.guild.roles.cache.get(rr.role);
  if (member && role && member.roles.cache.has(role.id)) member.roles.remove(role).catch(() => {});
}

/* ---------------- WELCOME & VERIFY ---------------- */

function getChannelMention(guild, possibleIds, possibleNames, defaultText) {
  for (const id of possibleIds) {
    const ch = guild.channels.cache.get(id);
    if (ch) return `<#${ch.id}>`;
  }
  for (const name of possibleNames) {
    const ch = guild.channels.cache.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
    if (ch) return `<#${ch.id}>`;
  }
  return defaultText;
}

export async function welcomeMember(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (cfg.autorole) {
    const role = member.guild.roles.cache.get(cfg.autorole);
    if (role) member.roles.add(role).catch(() => {});
  }
  if (cfg.verifyRole && member.guild.roles.cache.has(cfg.verifyRole)) {
    member.roles.add(cfg.verifyRole).catch(() => {});
  }
  if (!cfg.welcomeChannel) return;
  const ch = member.guild.channels.cache.get(cfg.welcomeChannel);
  if (!ch) return;

  const rulesRef = getChannelMention(member.guild, ['1533121565695414275'], ['rules', 'aturan'], '**#rules**');
  const introRef = getChannelMention(member.guild, ['1533121583495909478'], ['perkenalan', 'intro'], '**#perkenalan**');
  const annRef = getChannelMention(member.guild, ['1533121569306710076'], ['announcement', 'pengumuman'], '**#announcements**');
  const reqRef = getChannelMention(member.guild, ['1533135698083713024'], ['request', 'anime'], '**#request-anime**');
  const ticketRef = getChannelMention(member.guild, ['1533129443323936788'], ['ticket', 'bantuan'], '**#ticket**');

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('👋 Selamat Datang!')
    .setDescription([
      `Halo **${member.user.username}**, selamat datang di **${member.guild.name}**! 🎉`,
      `Kamu member ke-**${member.guild.memberCount}** di server ini.`,
      '',
      `📜 Baca ${rulesRef} biar nyaman bersama.`,
      `🌟 Perkenalkan dirimu di ${introRef}.`,
      `📢 Pantau ${annRef} untuk pengumuman terbaru.`,
      `🎬 Request anime di ${reqRef} atau buat tiket di ${ticketRef}.`,
      '',
      'Selamat menikmati diskusi seru! 🍿'
    ].join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `MahiStream Community • Akun dibuat <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` });
  await ch.send({ embeds: [embed] }).catch(() => {});
}

export async function farewellMember(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.welcomeChannel) return;
  const ch = member.guild.channels.cache.get(cfg.welcomeChannel);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('👋 Sampai Jumpa')
    .setDescription(`**${member.user.username}** meninggalkan server.\nSemoga kembali lagi suatu hari nanti! 🍿`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `MahiStream Community • member tersisa ${member.guild.memberCount}` });
  await ch.send({ embeds: [embed] }).catch(() => {});
}

/* ---------------- BACKUP ---------------- */

export async function createBackup(guild, label = 'auto') {
  const st = getGuildStorage(guild.id);
  const roles = guild.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, permissions: r.permissions.toArray() }));
  const channels = guild.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, topic: c.topic }));
  const backup = { id: Date.now().toString(), label, at: Date.now(), roles, channels };
  if (!st.backups) st.backups = [];
  st.backups.unshift(backup);
  if (st.backups.length > 10) st.backups.pop();
  st.antinuke.lastSnapshot = backup;
  saveGuildStorage(guild.id);
  return backup;
}

export async function restoreBackup(guild, id) {
  const st = getGuildStorage(guild.id);
  const b = (st.backups || []).find(x => x.id === id);
  if (!b) return null;
  for (const c of b.channels) {
    if (guild.channels.cache.has(c.id)) continue;
    try { await guild.channels.create({ name: c.name, type: c.type, parent: c.parentId || undefined, topic: c.topic || undefined }); } catch {}
  }
  return b;
}

/* ---------------- MODERATION HELPERS ---------------- */

export async function warnUser(guild, member, reason, mod) {
  const st = getGuildStorage(guild.id);
  const cfg = getGuildConfig(guild.id);
  if (!st.warns[member.id]) st.warns[member.id] = [];
  st.warns[member.id].push({ reason, by: mod, at: Date.now() });
  saveGuildStorage(guild.id);
  const count = st.warns[member.id].length;
  if (count >= cfg.warnBan && member.bannable) {
    await guild.members.ban(member.id, { reason: `Auto-ban: ${count} warn` });
    await logEvent(guild, '🔨 Auto-ban', `<@${member.id}> di-ban otomatis karena ${count} warning.`, Colors.Red);
  } else if (count >= cfg.warnMute) {
    await member.timeout(10 * 60 * 1000, `Auto-mute: ${count} warn`).catch(() => {});
    await logEvent(guild, '🔇 Auto-mute', `<@${member.id}> di-mute 10 menit karena ${count} warning.`, Colors.Orange);
  }
  return count;
}

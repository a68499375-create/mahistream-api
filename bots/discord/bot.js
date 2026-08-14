import { Client, GatewayIntentBits, Events, EmbedBuilder, Colors, SlashCommandBuilder, ChannelType, PermissionsBitField, AuditLogEvent } from 'discord.js';
import { loadConfig, getGuildConfig, getGuildStorage, saveGuildStorage, saveGuildConfig, loadFile, saveFile } from './storage.js';
import { logEvent, isTrusted, canManage, antiNukeCheck, lockdown, checkSpam, checkFilter, xpForMessage, levelXp, handleReactionAdd, handleReactionRemove, welcomeMember, farewellMember, createBackup, restoreBackup, warnUser } from './modules.js';

const cfgFile = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates] });
client.ownerId = cfgFile.ownerId;

const commands = [];
const add = (cmd) => commands.push(cmd);

add(new SlashCommandBuilder().setName('setup').setDescription('Konfigurasi bot untuk server ini')
  .addSubcommand(s => s.setName('log').setDescription('Atur channel log').addChannelOption(o => o.setName('channel').setDescription('Channel log').setRequired(true)))
  .addSubcommand(s => s.setName('welcome').setDescription('Atur channel welcome/farewell').addChannelOption(o => o.setName('channel').setDescription('Channel welcome').setRequired(true)))
  .addSubcommand(s => s.setName('verify').setDescription('Aktifkan sistem verifikasi').addChannelOption(o => o.setName('channel').setDescription('Channel verifikasi').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role yang diberi setelah verifikasi').setRequired(true)))
  .addSubcommand(s => s.setName('verifyoff').setDescription('Nonaktifkan sistem verifikasi'))
  .addSubcommand(s => s.setName('autorole').setDescription('Atur role otomatis saat join').addRoleOption(o => o.setName('role').setDescription('Role otomatis').setRequired(true)))
  .addSubcommand(s => s.setName('autoroleoff').setDescription('Hapus autorole'))
  .addSubcommand(s => s.setName('ticket').setDescription('Atur kategori ticket').addChannelOption(o => o.setName('category').setDescription('Kategori channel ticket').setRequired(true)))
  .addSubcommand(s => s.setName('levelreward').setDescription('Atur role reward leveling').addIntegerOption(o => o.setName('level').setDescription('Level').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role reward').setRequired(true)))
  .addSubcommand(s => s.setName('levelrewardoff').setDescription('Hapus role reward level').addIntegerOption(o => o.setName('level').setDescription('Level').setRequired(true)))
  .addSubcommand(s => s.setName('trusted').setDescription('Tambah user yang dipercaya (bebas anti-nuke)').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand(s => s.setName('untrusted').setDescription('Hapus user dari daftar trusted').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand(s => s.setName('warnconfig').setDescription('Atur ambang warn').addIntegerOption(o => o.setName('mute').setDescription('Jumlah warn -> mute').setRequired(false)).addIntegerOption(o => o.setName('ban').setDescription('Jumlah warn -> ban').setRequired(false)))
  .addSubcommand(s => s.setName('supportrole').setDescription('Atur role support (bisa melihat semua tiket)').addRoleOption(o => o.setName('role').setDescription('Role support').setRequired(true)))
  .addSubcommand(s => s.setName('invite').setDescription('Atur kode invite resmi server (whitelist)').addStringOption(o => o.setName('code').setDescription('Kode invite, mis. 8SqpJbbEwU').setRequired(true))));

add(new SlashCommandBuilder().setName('raid').setDescription('Mode anti-raid: blokir pesan sementara').addStringOption(o => o.setName('mode').setDescription('on/off').addChoices({ name: 'ON', value: 'on' }, { name: 'OFF', value: 'off' }).setRequired(true)));

add(new SlashCommandBuilder().setName('filter').setDescription('Kelola filter kata terlarang')
  .addSubcommand(s => s.setName('add').setDescription('Tambah kata').addStringOption(o => o.setName('word').setDescription('Kata').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Hapus kata').addStringOption(o => o.setName('word').setDescription('Kata').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('Daftar kata terfilter')));

add(new SlashCommandBuilder().setName('backup').setDescription('Backup / restore struktur server')
  .addSubcommand(s => s.setName('create').setDescription('Buat snapshot roles + channels'))
  .addSubcommand(s => s.setName('list').setDescription('Daftar snapshot'))
  .addSubcommand(s => s.setName('restore').setDescription('Restore channel dari snapshot').addStringOption(o => o.setName('id').setDescription('ID snapshot').setRequired(true))));

add(new SlashCommandBuilder().setName('lockdown').setDescription('Lock/unlock semua channel').addStringOption(o => o.setName('mode').setDescription('on/off').addChoices({ name: 'ON', value: 'on' }, { name: 'OFF', value: 'off' }).setRequired(true)));
add(new SlashCommandBuilder().setName('lock').setDescription('Kunci channel (hanya read)').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(false)));
add(new SlashCommandBuilder().setName('unlock').setDescription('Buka channel').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(false)));
add(new SlashCommandBuilder().setName('slowmode').setDescription('Atur slowmode').addIntegerOption(o => o.setName('seconds').setDescription('Detik (0 = mati)').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(false)));
add(new SlashCommandBuilder().setName('clear').setDescription('Hapus pesan massal').addIntegerOption(o => o.setName('count').setDescription('Jumlah (1-100)').setRequired(true)));

add(new SlashCommandBuilder().setName('kick').setDescription('Kick member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Alasan').setRequired(false)));
add(new SlashCommandBuilder().setName('ban').setDescription('Ban member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Alasan').setRequired(false)));
add(new SlashCommandBuilder().setName('softban').setDescription('Ban lalu unban (hapus pesan)').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Alasan').setRequired(false)));
add(new SlashCommandBuilder().setName('unban').setDescription('Unban user').addStringOption(o => o.setName('userid').setDescription('ID user').setRequired(true)));
add(new SlashCommandBuilder().setName('mute').setDescription('Mute (timeout) member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Menit (default 10)').setRequired(false)).addStringOption(o => o.setName('reason').setDescription('Alasan').setRequired(false)));
add(new SlashCommandBuilder().setName('unmute').setDescription('Unmute member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)));
add(new SlashCommandBuilder().setName('warn').setDescription('Warn member').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Alasan').setRequired(true)));
add(new SlashCommandBuilder().setName('unwarn').setDescription('Hapus warning').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)));
add(new SlashCommandBuilder().setName('warns').setDescription('Lihat daftar warning').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)));
add(new SlashCommandBuilder().setName('role').setDescription('Kasih/ambil role').addSubcommand(s => s.setName('add').setDescription('Kasih role').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))).addSubcommand(s => s.setName('remove').setDescription('Ambil role').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))));

add(new SlashCommandBuilder().setName('ping').setDescription('Cek ping bot'));
add(new SlashCommandBuilder().setName('userinfo').setDescription('Info user').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)));
add(new SlashCommandBuilder().setName('serverinfo').setDescription('Info server'));
add(new SlashCommandBuilder().setName('avatar').setDescription('Ambil avatar').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)));
add(new SlashCommandBuilder().setName('rank').setDescription('Cek level kamu').addUserOption(o => o.setName('user').setDescription('User').setRequired(false)));
add(new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 level'));
add(new SlashCommandBuilder().setName('poll').setDescription('Buat polling').addStringOption(o => o.setName('question').setDescription('Pertanyaan').setRequired(true)).addStringOption(o => o.setName('op1').setDescription('Opsi 1').setRequired(true)).addStringOption(o => o.setName('op2').setDescription('Opsi 2').setRequired(true)).addStringOption(o => o.setName('op3').setDescription('Opsi 3').setRequired(false)).addStringOption(o => o.setName('op4').setDescription('Opsi 4').setRequired(false)).addStringOption(o => o.setName('op5').setDescription('Opsi 5').setRequired(false)).addStringOption(o => o.setName('op6').setDescription('Opsi 6').setRequired(false)).addStringOption(o => o.setName('op7').setDescription('Opsi 7').setRequired(false)).addStringOption(o => o.setName('op8').setDescription('Opsi 8').setRequired(false)).addStringOption(o => o.setName('op9').setDescription('Opsi 9').setRequired(false)).addStringOption(o => o.setName('op10').setDescription('Opsi 10').setRequired(false)));
add(new SlashCommandBuilder().setName('ticket').setDescription('Sistem tiket bantuan')
  .addSubcommand(s => s.setName('setup').setDescription('Pasang panel tiket (dropdown kategori) di channel ini — admin'))
  .addSubcommand(s => s.setName('open').setDescription('Buka ticket langsung').addStringOption(o => o.setName('reason').setDescription('Topik/keperluan').setRequired(false))));
add(new SlashCommandBuilder().setName('remind').setDescription('Reminder pribadi').addStringOption(o => o.setName('time').setDescription('Contoh: 10m, 1h, 2d').setRequired(true)).addStringOption(o => o.setName('text').setDescription('Pesan reminder').setRequired(true)));
add(new SlashCommandBuilder().setName('rr').setDescription('Reaction roles')
  .addSubcommand(s => s.setName('add').setDescription('Tambah reaction role').addStringOption(o => o.setName('messageid').setDescription('ID pesan').setRequired(true)).addStringOption(o => o.setName('emoji').setDescription('Emoji (nama atau id)').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Hapus reaction role').addStringOption(o => o.setName('messageid').setDescription('ID pesan').setRequired(true)).addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('Daftar reaction roles').addStringOption(o => o.setName('messageid').setDescription('ID pesan').setRequired(true))));

add(new SlashCommandBuilder().setName('afk').setDescription('Set status AFK').addStringOption(o => o.setName('reason').setDescription('Alasan AFK').setRequired(false)));
add(new SlashCommandBuilder().setName('snipe').setDescription('Lihat pesan terakhir yang dihapus di channel ini').addStringOption(o => o.setName('action').setDescription('clear = bersihkan').addChoices({ name: 'Clear', value: 'clear' }).setRequired(false)));
add(new SlashCommandBuilder().setName('8ball').setDescription('Tanya ya/tidak, jawab 8-ball').addStringOption(o => o.setName('question').setDescription('Pertanyaan').setRequired(true)));
add(new SlashCommandBuilder().setName('dice').setDescription('Lempar dadu').addIntegerOption(o => o.setName('sides').setDescription('Jumlah sisi (default 6)').setRequired(false)));
add(new SlashCommandBuilder().setName('coinflip').setDescription('Lempar koin'));
add(new SlashCommandBuilder().setName('roll').setDescription('Angka acak 1-max').addIntegerOption(o => o.setName('max').setDescription('Maksimal (default 100)').setRequired(false)));
add(new SlashCommandBuilder().setName('joke').setDescription('Dapatkan lelucon singkat'));
add(new SlashCommandBuilder().setName('quote').setDescription('Kutipan motivasi acak'));
add(new SlashCommandBuilder().setName('embed').setDescription('Buat embed custom').addStringOption(o => o.setName('title').setDescription('Judul').setRequired(true)).addStringOption(o => o.setName('description').setDescription('Deskripsi').setRequired(true)));
add(new SlashCommandBuilder().setName('say').setDescription('Bot mengirim pesan (admin)').addStringOption(o => o.setName('message').setDescription('Pesan').setRequired(true)));
add(new SlashCommandBuilder().setName('timer').setDescription('Reminder di channel').addIntegerOption(o => o.setName('minutes').setDescription('Menit').setRequired(true)).addStringOption(o => o.setName('text').setDescription('Pesan').setRequired(true)));
add(new SlashCommandBuilder().setName('randomanime').setDescription('Rekomendasi anime acak'));
add(new SlashCommandBuilder().setName('changelog').setDescription('Log perubahan versi MahiStream'));

const TICKET_CATEGORIES = [
  { value: 'Bantuan Umum', label: '🎫 Bantuan Umum', description: 'Pertanyaan seputar server/MahiStream' },
  { value: 'Laporan Bug', label: '🐞 Laporan Bug', description: 'Laporkan bug atau error' },
  { value: 'Request Anime', label: '📩 Request Anime', description: 'Request judul anime baru' },
  { value: 'Lainnya', label: '📦 Lainnya', description: 'Topik lainnya' }
];

const RULE_WORDS = ['nude', 'porn', 'porno', 'bokep', 'xxx', 'hentai', 'telanjang', 'bugil', 'ngentot', 'kontol', 'memek', 'jancok', 'bangsat', 'bajingan', 'kampret', 'goblok', 'tolol', 'fuck', 'bitch', 'shit', 'dick', 'pussy', 'asshole'];
const RULE_INVITE_RE = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([A-Za-z0-9_-]+)/g;

async function createTicket(interaction, categoryName, source) {
  const guild = interaction.guild;
  const cfg = getGuildConfig(guild.id);
  const cat = cfg.ticketCategory ? guild.channels.cache.get(cfg.ticketCategory) : null;
  if (!cat || cat.type !== ChannelType.GuildCategory) return { ok: false, msg: '❌ Kategori ticket belum diatur. Admin: `/setup ticket`' };
  const st = getGuildStorage(guild.id);
  st.tickets = st.tickets || {};
  const existing = guild.channels.cache.find(c => st.tickets[c.id] && st.tickets[c.id].ownerId === interaction.user.id);
  if (existing) return { ok: false, msg: `❌ Kamu sudah punya ticket: <#${existing.id}>` };
  const today = new Date().toISOString().slice(0, 10);
  if (st.ticketDate !== today) { st.ticketDate = today; st.ticketCounter = 0; }
  st.ticketCounter = (st.ticketCounter || 0) + 1;
  const code = String(st.ticketCounter).padStart(4, '0');
  const ch = await guild.channels.create({ name: `tiket-${code}`, type: ChannelType.GuildText, parent: cat, topic: `Ticket ${categoryName} — ${interaction.user.username}`, permissionOverwrites: [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
  ] });
  if (cfg.supportRole) await ch.permissionOverwrites.create(cfg.supportRole, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
  st.tickets[ch.id] = { ownerId: interaction.user.id, category: categoryName, claimedBy: null, createdAt: Date.now(), code, username: interaction.user.username };
  saveGuildStorage(guild.id);
  const row = { type: 1, components: [
    { type: 2, style: 1, customId: 'ticket_claim', label: '📥 Claim' },
    { type: 2, style: 2, customId: 'ticket_adduser', label: '👤 Tambah User' },
    { type: 2, style: 2, customId: 'ticket_transcript', label: '📄 Transcript' },
    { type: 2, style: 4, customId: 'ticket_close', label: '🔒 Tutup Ticket' }
  ] };
  const embed = new EmbedBuilder().setColor(Colors.Green).setTitle(`🎫 Ticket #${code}`)
    .setDescription(`Kategori: **${categoryName}**\nPembuat: <@${interaction.user.id}>\nSumber: ${source}\n\nJelaskan keperluanmu di channel ini. Tim support akan segera merespon.`)
    .setFooter({ text: 'MahiStream Bot • Klik Claim untuk mengambil tiket' });
  await ch.send({ embeds: [embed], components: [row] });
  await logEvent(guild, '🎫 Ticket dibuka', `<@${interaction.user.id}> membuka ticket **#${code}** (${categoryName}) di <#${ch.id}>.\nSumber: ${source}`, Colors.Green);
  return { ok: true, id: ch.id };
}

const UPDATE_CHANNEL_ID = process.env.UPDATE_CHANNEL_ID || '1533121600386367568';
const MAHI_API = (process.env.MAHI_API || 'https://mahistream-api-production.up.railway.app') + '/api/anime?limit=300';
const WEB_URL = process.env.WEB_URL || 'https://mahistream.pages.dev';

async function checkMahiUpdates(client, silent = false) {
  const ch = client.channels.cache.get(UPDATE_CHANNEL_ID);
  const st = loadFile('updates', { snapshot: null });
  st.snapshot = st.snapshot || {};
  let data;
  try {
    const res = await fetch(MAHI_API);
    if (!res.ok) return [];
    data = await res.json();
  } catch { return []; }
  const list = (data && data.animeList) || [];
  const sent = [];
  for (const a of list) {
    if (!a || !a.id) continue;
    const prev = st.snapshot[a.id];
    const eps = Number(a.episode_count) || 0;
    if (!prev) {
      st.snapshot[a.id] = { title: a.title, eps, poster: a.poster || null };
      if (silent) continue;
      const embed = new EmbedBuilder().setColor(Colors.Green).setTitle('🎬 Anime Baru Ditambahkan')
        .setDescription(`**${a.title}**${a.title_jp ? `\n*${a.title_jp}*` : ''}\n\n📺 **${eps}** episode\n🏷️ ${(a.genres || []).slice(0, 3).join(', ') || '—'}\n\n🔗 Tonton: ${WEB_URL}/anime/${a.id}`)
        .setFooter({ text: 'MahiStream Update' });
      if (typeof a.poster === 'string' && a.poster.startsWith('http')) embed.setThumbnail(a.poster);
      await ch.send({ embeds: [embed] }).catch(() => {});
      sent.push(`anime:${a.id}`);
    } else if (eps > prev.eps) {
      st.snapshot[a.id] = { title: a.title, eps, poster: a.poster || prev.poster };
      if (silent) continue;
      const embed = new EmbedBuilder().setColor(Colors.Blue).setTitle('📺 Episode Baru')
        .setDescription(`**${a.title}**\n\nKini tersedia **${eps}** episode (sebelumnya ${prev.eps}).\n\n🔗 Tonton: ${WEB_URL}/anime/${a.id}`)
        .setFooter({ text: 'MahiStream Update' });
      if (typeof a.poster === 'string' && a.poster.startsWith('http')) embed.setThumbnail(a.poster);
      await ch.send({ embeds: [embed] }).catch(() => {});
      sent.push(`eps:${a.id}`);
    }
  }
  saveFile('updates', st);
  return sent;
}

client.once(Events.ClientReady, async () => {
  console.log(`[DISCORD] Online sebagai ${client.user.tag}`);
  client.user.setActivity('/help server | MahiStream', { type: 3 });
  try {
    const guild = client.guilds.cache.get(cfgFile.guildId);
    if (guild) {
      await guild.commands.set(commands);
      console.log(`[DISCORD] ${commands.length} slash command terdaftar di guild`);
      const st = getGuildStorage(guild.id);
      if (!st.antinuke.lastSnapshot) await createBackup(guild, 'auto-pertama');
    }
  } catch (e) { console.error('Register command gagal:', e.message); }
  setInterval(() => {
    for (const g of client.guilds.cache.values()) createBackup(g, 'auto').catch(() => {});
  }, 30 * 60 * 1000);
  checkMahiUpdates(client, true).catch(() => {});
  setInterval(() => checkMahiUpdates(client).catch(() => {}), 5 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_cat') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const r = await createTicket(interaction, interaction.values[0], 'Panel tiket');
      return interaction.editReply({ content: r.ok ? `✅ Ticket dibuat: <#${r.id}>` : r.msg });
    } catch (e) {
      return interaction.editReply({ content: '❌ Gagal membuat tiket: ' + e.message });
    }
  }
  if (interaction.isModalSubmit() && interaction.customId === 'ticket_adduser_modal') {
    const id = interaction.fields.getTextInputValue('user_id').trim();
    if (!/^\d{15,20}$/.test(id)) return interaction.reply({ content: '❌ ID tidak valid.', ephemeral: true });
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ User tidak ditemukan di server.', ephemeral: true });
    await interaction.channel.permissionOverwrites.create(member, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    await logEvent(interaction.guild, '👤 User ditambah ke tiket', `<@${member.id}> ditambahkan ke <#${interaction.channel.id}> oleh <@${interaction.user.id}>.`, Colors.Blue);
    return interaction.reply({ content: `✅ <@${member.id}> sekarang bisa melihat tiket ini.`, ephemeral: true });
  }
  if (interaction.isButton()) {
    if (interaction.customId === 'verify_btn') {
      const cfg = getGuildConfig(interaction.guild.id);
      const role = interaction.guild.roles.cache.get(cfg.verifyRole);
      if (!role) return interaction.reply({ content: 'Sistem verifikasi belum dikonfigurasi.', ephemeral: true });
      await interaction.member.roles.add(role).catch(() => {});
      return interaction.reply({ content: `✅ Verifikasi berhasil! Kamu mendapat role **${role.name}**.`, ephemeral: true });
    }
    if (interaction.customId === 'ticket_close') {
      if (!canManage(interaction)) return interaction.reply({ content: 'Kamu tidak punya izin.', ephemeral: true });
      const stT = getGuildStorage(interaction.guild.id);
      const info = (stT.tickets || {})[interaction.channel.id];
      let lines = [];
      try {
        const msgs = await interaction.channel.messages.fetch({ limit: 100 });
        msgs.reverse().forEach(m => { if (!m.author.bot) lines.push(`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || '[embed/sticker]'}`); });
      } catch {}
      await interaction.reply({ content: 'Ticket ditutup, transcript dikirim & channel akan dihapus...', ephemeral: true });
      if (info) { info.closedAt = Date.now(); saveGuildStorage(interaction.guild.id); }
      if (lines.length) {
        const cfgL = getGuildConfig(interaction.guild.id);
        if (cfgL.logChannel) {
          const logCh = interaction.guild.channels.cache.get(cfgL.logChannel);
          if (logCh) {
            const file = Buffer.from(lines.join('\n'), 'utf8');
            await logCh.send({ embeds: [new EmbedBuilder().setColor(Colors.Grey).setTitle('📄 Transcript Tiket').setDescription(`Channel: ${interaction.channel.name}\nKategori: ${info?.category || '-'}\nPemilik: ${info?.ownerId ? `<@${info.ownerId}>` : '-'}\nDitutup oleh: <@${interaction.user.id}>`).setFooter({ text: `Jumlah pesan: ${lines.length}` })], files: [{ attachment: file, name: `transcript-${interaction.channel.id}.txt` }] }).catch(() => {});
          }
        }
      }
      await logEvent(interaction.guild, '🔒 Ticket ditutup', `Ticket <#${interaction.channel.id}> ditutup oleh <@${interaction.user.id}>.`, Colors.Red);
      return setTimeout(() => interaction.channel.delete('Ticket ditutup').catch(() => {}), 1500);
    }
    if (interaction.customId === 'ticket_claim') {
      if (!canManage(interaction)) return interaction.reply({ content: 'Kamu tidak punya izin.', ephemeral: true });
      const stT = getGuildStorage(interaction.guild.id);
      stT.tickets = stT.tickets || {};
      if (!stT.tickets[interaction.channel.id]) return interaction.reply({ content: '❌ Ini bukan channel tiket terdaftar.', ephemeral: true });
      stT.tickets[interaction.channel.id].claimedBy = interaction.user.id;
      saveGuildStorage(interaction.guild.id);
      await logEvent(interaction.guild, '📥 Ticket di-claim', `Ticket <#${interaction.channel.id}> di-claim oleh <@${interaction.user.id}>.`, Colors.Blue);
      return interaction.reply({ content: `✅ Ticket di-claim oleh <@${interaction.user.id}>.`, ephemeral: true });
    }
    if (interaction.customId === 'ticket_transcript') {
      if (!canManage(interaction)) return interaction.reply({ content: 'Kamu tidak punya izin.', ephemeral: true });
      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const lines = msgs.reverse().map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.bot ? 'BOT' : m.author.tag}: ${m.content || '[embed/sticker]'}`).join('\n') || 'Kosong';
      const file = Buffer.from(lines, 'utf8');
      return interaction.reply({ content: '📄 Transcript:', ephemeral: true, files: [{ attachment: file, name: `transcript-${interaction.channel.id}.txt` }] });
    }
    if (interaction.customId === 'ticket_adduser') {
      if (!canManage(interaction)) return interaction.reply({ content: 'Kamu tidak punya izin.', ephemeral: true });
      return interaction.showModal({
        customId: 'ticket_adduser_modal',
        title: 'Tambah User ke Ticket',
        components: [{ type: 1, components: [{ type: 4, customId: 'user_id', label: 'User ID', style: 1, required: true, placeholder: 'Paste User ID di sini', min_length: 15, max_length: 20 }] }]
      });
    }
    if (interaction.customId === 'ticket_open') {
      const cfg = getGuildConfig(interaction.guild.id);
      const cat = cfg.ticketCategory ? interaction.guild.channels.cache.get(cfg.ticketCategory) : null;
      if (!cat || cat.type !== ChannelType.GuildCategory) return interaction.reply({ content: '❌ Kategori ticket belum diatur. Admin: `/setup ticket`', ephemeral: true });
      const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase()}`);
      if (existing) return interaction.reply({ content: `❌ Kamu sudah punya ticket: <#${existing.id}>`, ephemeral: true });
      const ch = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username.toLowerCase()}`, type: ChannelType.GuildText, parent: cat, permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ] });
      const row = { type: 1, components: [{ type: 2, style: 4, customId: 'ticket_close', label: '🔒 Tutup Ticket', emoji: { name: '🔒' } }] };
      await ch.send({ embeds: [new EmbedBuilder().setColor(Colors.Green).setTitle('🎫 Ticket Baru').setDescription(`Pembuat: <@${interaction.user.id}>\nSumber: Panel buat tiket\nTim support akan segera merespon.`)], components: [row] });
      await logEvent(interaction.guild, '🎫 Ticket dibuka', `<@${interaction.user.id}> membuka ticket <#${ch.id}>.\nSumber: Panel buat tiket`, Colors.Green);
      return interaction.reply({ content: `✅ Ticket dibuat: <#${ch.id}>`, ephemeral: true });
    }
    if (interaction.customId === 'request_anime') {
      const cat = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.includes('MAHISTREAM'));
      if (!cat) return interaction.reply({ content: '❌ Kategori MAHISTREAM tidak ditemukan.', ephemeral: true });
      const existing = interaction.guild.channels.cache.find(c => c.name === `request-${interaction.user.username.toLowerCase()}`);
      if (existing) return interaction.reply({ content: `❌ Kamu sudah punya request: <#${existing.id}>`, ephemeral: true });
      const ch = await interaction.guild.channels.create({ name: `request-${interaction.user.username.toLowerCase()}`, type: ChannelType.GuildText, parent: cat, permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ] });
      const row = { type: 1, components: [{ type: 2, style: 4, customId: 'request_close', label: '🔒 Tutup Request', emoji: { name: '🔒' } }] };
      await ch.send({ embeds: [new EmbedBuilder().setColor(Colors.Blue).setTitle('📩 Request Anime Baru').setDescription(`Pembuat: <@${interaction.user.id}>\nTulis judul anime yang kamu mau di channel ini.\nTim kami akan menambahkannya secepatnya.`)], components: [row] });
      await logEvent(interaction.guild, '📩 Request anime', `<@${interaction.user.id}> request anime di <#${ch.id}>.`, Colors.Blue);
      return interaction.reply({ content: `✅ Request dibuat: <#${ch.id}>`, ephemeral: true });
    }
    if (interaction.customId === 'request_close') {
      const expected = `request-${interaction.user.username.toLowerCase()}`;
      if (interaction.channel.name !== expected && !canManage(interaction)) return interaction.reply({ content: 'Kamu tidak punya izin.', ephemeral: true });
      await interaction.reply({ content: 'Request ditutup, channel akan dihapus...', ephemeral: true });
      return setTimeout(() => interaction.channel.delete('Request ditutup').catch(() => {}), 1500);
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options } = interaction;
  const guild = interaction.guild;
  const cfg = getGuildConfig(guild.id);
  const st = getGuildStorage(guild.id);
  const needAdmin = ['setup', 'raid', 'filter', 'backup', 'lockdown', 'lock', 'unlock', 'slowmode', 'clear', 'kick', 'ban', 'softban', 'unban', 'mute', 'unmute', 'warn', 'unwarn', 'role', 'rr', 'say'];
  if (needAdmin.includes(commandName) && !canManage(interaction)) return interaction.reply({ content: '❌ Kamu tidak punya izin admin.', ephemeral: true });
  if (!cfg.lockdown && commandName === 'ticket' && !interaction.channel.name?.startsWith('ticket')) { /* ok */ }

  try {
    switch (commandName) {
      case 'ping': {
        const m = await interaction.reply({ content: '🏓 Mengukur ping...', fetchReply: true });
        return interaction.editReply(`🏓 **Pong!** Latensi: ${m.createdTimestamp - interaction.createdTimestamp}ms | API: ${Math.round(client.ws.ping)}ms`);
      }
      case 'setup': {
        const sub = options.getSubcommand();
        const ch = options.getChannel('channel');
        const role = options.getRole('role');
        const user = options.getUser('user');
        const cat = options.getChannel('category');
        if (sub === 'log') { cfg.logChannel = ch.id; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Channel log diset ke <#${ch.id}>.`, ephemeral: true }); }
        if (sub === 'welcome') { cfg.welcomeChannel = ch.id; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Channel welcome diset ke <#${ch.id}>.`, ephemeral: true }); }
        if (sub === 'verify') {
          cfg.verifyChannel = ch.id; cfg.verifyRole = role.id;
          if (!st.antinuke.lastSnapshot) await createBackup(guild, 'sebelum-verify');
          await ch.permissionOverwrites.create(guild.roles.everyone, { SendMessages: false, ViewChannel: true }).catch(() => {});
          const row = { type: 1, components: [{ type: 2, style: 3, customId: 'verify_btn', label: '✅ Verifikasi Saya', emoji: { name: '✅' } }] };
          await ch.send({ embeds: [new EmbedBuilder().setColor(Colors.Green).setTitle('✅ Verifikasi Member').setDescription('Klik tombol di bawah untuk diverifikasi dan mendapat akses penuh ke server.')], components: [row] });
          saveGuildConfig(guild.id);
          return interaction.reply({ content: `✅ Sistem verifikasi aktif. Role: <@&${role.id}> di <#${ch.id}>.`, ephemeral: true });
        }
        if (sub === 'verifyoff') { cfg.verifyRole = null; cfg.verifyChannel = null; saveGuildConfig(guild.id); return interaction.reply({ content: '✅ Sistem verifikasi dinonaktifkan.', ephemeral: true }); }
        if (sub === 'autorole') { cfg.autorole = role.id; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Autorole: <@&${role.id}>.`, ephemeral: true }); }
        if (sub === 'autoroleoff') { cfg.autorole = null; saveGuildConfig(guild.id); return interaction.reply({ content: '✅ Autorole dihapus.', ephemeral: true }); }
        if (sub === 'ticket') { cfg.ticketCategory = cat.id; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Kategori ticket: ${cat.name}.`, ephemeral: true }); }
        if (sub === 'supportrole') { cfg.supportRole = role.id; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Role support: <@&${role.id}> (bisa melihat semua tiket).`, ephemeral: true }); }
        if (sub === 'invite') { cfg.inviteCode = options.getString('code').toLowerCase(); saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Kode invite resmi: \`${cfg.inviteCode}\` (link undangan lain otomatis diblokir).`, ephemeral: true }); }
        if (sub === 'levelreward') { cfg.levelRewards[options.getInteger('level')] = role.id; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Level ${options.getInteger('level')} -> <@&${role.id}>.`, ephemeral: true }); }
        if (sub === 'levelrewardoff') { delete cfg.levelRewards[options.getInteger('level')]; saveGuildConfig(guild.id); return interaction.reply({ content: `✅ Reward level ${options.getInteger('level')} dihapus.`, ephemeral: true }); }
        if (sub === 'trusted') { if (!cfg.trusted.includes(user.id)) cfg.trusted.push(user.id); saveGuildConfig(guild.id); return interaction.reply({ content: `✅ <@${user.id}> ditambahkan ke trusted.`, ephemeral: true }); }
        if (sub === 'untrusted') { cfg.trusted = cfg.trusted.filter(x => x !== user.id); saveGuildConfig(guild.id); return interaction.reply({ content: `✅ <@${user.id}> dihapus dari trusted.`, ephemeral: true }); }
        if (sub === 'warnconfig') {
          if (options.getInteger('mute') !== null) cfg.warnMute = options.getInteger('mute');
          if (options.getInteger('ban') !== null) cfg.warnBan = options.getInteger('ban');
          saveGuildConfig(guild.id);
          return interaction.reply({ content: `✅ Ambang warn: mute=${cfg.warnMute}, ban=${cfg.warnBan}.`, ephemeral: true });
        }
        return;
      }
      case 'raid': {
        const mode = options.getString('mode');
        cfg.raidMode = mode === 'on';
        saveGuildConfig(guild.id);
        if (mode === 'on') await lockdown(guild, true);
        return interaction.reply({ content: `🚨 Mode anti-raid **${mode === 'on' ? 'AKTIF' : 'MATI'}**.${mode === 'on' ? ' Semua channel di-lock, gunakan /lockdown off setelah aman.' : ''}`, ephemeral: true });
      }
      case 'lockdown': {
        const mode = options.getString('mode');
        const n = await lockdown(guild, mode === 'on');
        await logEvent(guild, mode === 'on' ? '🔒 LOCKDOWN' : '🔓 UNLOCK', `${n} channel ${mode === 'on' ? 'dikunci' : 'dibuka'} oleh <@${interaction.user.id}>.`, mode === 'on' ? Colors.Red : Colors.Green);
        return interaction.reply({ content: `✅ ${n} channel ${mode === 'on' ? 'dikunci' : 'dibuka'}.`, ephemeral: true });
      }
      case 'lock': case 'unlock': {
        const ch = options.getChannel('channel') || interaction.channel;
        if (commandName === 'lock') await ch.permissionOverwrites.create(guild.roles.everyone, { SendMessages: false });
        else await ch.permissionOverwrites.delete(guild.roles.everyone).catch(() => {});
        return interaction.reply({ content: `✅ Channel ${ch.name} ${commandName === 'lock' ? 'dikunci' : 'dibuka'}.`, ephemeral: true });
      }
      case 'slowmode': {
        const ch = options.getChannel('channel') || interaction.channel;
        await ch.setRateLimitPerUser(options.getInteger('seconds'));
        return interaction.reply({ content: `✅ Slowmode <#${ch.id}>: ${options.getInteger('seconds')}s.`, ephemeral: true });
      }
      case 'clear': {
        const n = Math.min(options.getInteger('count'), 100);
        const msgs = await interaction.channel.messages.fetch({ limit: n });
        await interaction.channel.bulkDelete(msgs, true);
        await logEvent(guild, '🧹 Clear', `${n} pesan dihapus di <#${interaction.channel.id}> oleh <@${interaction.user.id}>.`, Colors.Blue);
        return interaction.reply({ content: `✅ ${msgs.size} pesan dihapus.`, ephemeral: true });
      }
      case 'kick': case 'ban': case 'softban': {
        const u = options.getUser('user');
        const reason = options.getString('reason') || 'Tidak ada alasan';
        if (commandName === 'kick') {
          const m = guild.members.cache.get(u.id);
          if (!m?.kickable) return interaction.reply({ content: '❌ Tidak bisa kick user ini.', ephemeral: true });
          await m.kick(reason);
          await logEvent(guild, '👢 Kick', `<@${u.id}> di-kick oleh <@${interaction.user.id}>\nAlasan: ${reason}`, Colors.Orange);
        } else if (commandName === 'softban') {
          await guild.members.ban(u.id, { reason, deleteMessageSeconds: 86400 });
          await guild.members.unban(u.id).catch(() => {});
          await logEvent(guild, '🍞 Softban', `<@${u.id}> di-softban oleh <@${interaction.user.id}>\nAlasan: ${reason}`, Colors.Orange);
        } else {
          await guild.members.ban(u.id, { reason });
          await logEvent(guild, '🔨 Ban', `<@${u.id}> di-ban oleh <@${interaction.user.id}>\nAlasan: ${reason}`, Colors.Red);
        }
        return interaction.reply({ content: `✅ ${commandName === 'kick' ? 'Kick' : 'Ban'} berhasil.`, ephemeral: true });
      }
      case 'unban': {
        await guild.members.unban(options.getString('userid'), 'Unban');
        await logEvent(guild, '♻️ Unban', `<@${options.getString('userid')}> di-unban oleh <@${interaction.user.id}>.`, Colors.Green);
        return interaction.reply({ content: '✅ Unban berhasil.', ephemeral: true });
      }
      case 'mute': case 'unmute': {
        const u = options.getUser('user');
        const m = guild.members.cache.get(u.id);
        if (!m) return interaction.reply({ content: '❌ Member tidak ditemukan.', ephemeral: true });
        if (commandName === 'mute') {
          const mins = options.getInteger('minutes') || 10;
          await m.timeout(mins * 60 * 1000, options.getString('reason') || 'Mute');
          await logEvent(guild, '🔇 Mute', `<@${u.id}> di-mute ${mins} menit oleh <@${interaction.user.id}>${options.getString('reason') ? '\nAlasan: ' + options.getString('reason') : ''}`, Colors.Orange);
        } else {
          await m.timeout(null);
          await logEvent(guild, '🔊 Unmute', `<@${u.id}> di-unmute oleh <@${interaction.user.id}>.`, Colors.Green);
        }
        return interaction.reply({ content: `✅ ${commandName === 'mute' ? 'Mute' : 'Unmute'} berhasil.`, ephemeral: true });
      }
      case 'warn': case 'unwarn': {
        const u = options.getUser('user');
        if (commandName === 'warn') {
          const count = await warnUser(guild, guild.members.cache.get(u.id), options.getString('reason'), interaction.user.id);
          await logEvent(guild, '⚠️ Warn', `<@${u.id}> di-warn oleh <@${interaction.user.id}>\nAlasan: ${options.getString('reason')}\nTotal: **${count} warn**`, Colors.Yellow);
          return interaction.reply({ content: `✅ ${u.username} di-warn (total ${count}).`, ephemeral: true });
        }
        const arr = st.warns[u.id] || [];
        if (!arr.length) return interaction.reply({ content: '❌ Tidak ada warning.', ephemeral: true });
        st.warns[u.id].shift();
        saveGuildStorage(guild.id);
        return interaction.reply({ content: `✅ 1 warning <@${u.id}> dihapus (sisa ${st.warns[u.id].length}).`, ephemeral: true });
      }
      case 'warns': {
        const u = options.getUser('user');
        const arr = st.warns[u.id] || [];
        if (!arr.length) return interaction.reply({ content: `✅ ${u.username} bersih, tidak ada warning.`, ephemeral: true });
        const desc = arr.map((w, i) => `**${i + 1}.** ${w.reason} — oleh <@${w.by}> (<t:${Math.floor(w.at / 1000)}:R>)`).join('\n');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Yellow).setTitle(`⚠️ Warning ${u.username} (${arr.length})`).setDescription(desc)] });
      }
      case 'role': {
        const sub = options.getSubcommand();
        const u = options.getUser('user');
        const role = options.getRole('role');
        const m = guild.members.cache.get(u.id);
        if (!m) return interaction.reply({ content: '❌ Member tidak ditemukan.', ephemeral: true });
        if (sub === 'add') await m.roles.add(role);
        else await m.roles.remove(role);
        return interaction.reply({ content: `✅ Role <@&${role.id}> ${sub === 'add' ? 'diberikan ke' : 'diambil dari'} <@${u.id}>.`, ephemeral: true });
      }
      case 'userinfo': {
        const u = options.getUser('user') || interaction.user;
        const m = guild.members.cache.get(u.id);
        const roles = m ? m.roles.cache.filter(r => r.id !== guild.id).map(r => `<@&${r.id}>`).join(' ') || 'Tidak ada' : '-';
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setAuthor({ name: u.username, iconURL: u.displayAvatarURL() }).addFields(
          { name: '👤 User', value: `<@${u.id}> (${u.id})`, inline: true },
          { name: '🤖 Bot', value: u.bot ? 'Ya' : 'Tidak', inline: true },
          { name: '📅 Akun dibuat', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📅 Gabung server', value: m ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : '-', inline: true },
          { name: '🎭 Roles', value: roles.slice(0, 1024) }
        ).setThumbnail(u.displayAvatarURL({ size: 256 }))] });
      }
      case 'serverinfo': {
        const boostCount = guild.premiumSubscriptionCount || 0;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setAuthor({ name: guild.name, iconURL: guild.iconURL() || undefined }).addFields(
          { name: '🆔 ID', value: guild.id, inline: true },
          { name: '👥 Member', value: String(guild.memberCount), inline: true },
          { name: '🚀 Boost', value: String(boostCount), inline: true },
          { name: '💬 Channel', value: String(guild.channels.cache.size), inline: true },
          { name: '🎭 Roles', value: String(guild.roles.cache.size), inline: true },
          { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: '📅 Dibuat', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
        ).setThumbnail(guild.iconURL({ size: 256 }) || null)] });
      }
      case 'avatar': {
        const u = options.getUser('user') || interaction.user;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle(`Avatar ${u.username}`).setImage(u.displayAvatarURL({ size: 1024 })).setURL(u.displayAvatarURL({ size: 1024 }))] });
      }
      case 'rank': {
        const u = options.getUser('user') || interaction.user;
        const d = st.levels[u.id];
        if (!d) return interaction.reply({ content: `🔹 ${u.username} belum punya XP. Kirim pesan dulu!`, ephemeral: true });
        const next = levelXp(d.level);
        const sorted = Object.entries(st.levels).sort((a, b) => b[1].xp + b[1].level * 100000 - (a[1].xp + a[1].level * 100000));
        const pos = sorted.findIndex(x => x[0] === u.id) + 1;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setAuthor({ name: u.username, iconURL: u.displayAvatarURL() }).addFields(
          { name: '📊 Level', value: String(d.level), inline: true },
          { name: '✨ XP', value: `${d.xp}/${next}`, inline: true },
          { name: '🏆 Peringkat', value: `#${pos}`, inline: true }
        )] });
      }
      case 'leaderboard': {
        const sorted = Object.entries(st.levels).sort((a, b) => b[1].xp + b[1].level * 100000 - (a[1].xp + a[1].level * 100000)).slice(0, 10);
        const desc = sorted.map(([id, d], i) => `**${i + 1}.** <@${id}> — Level **${d.level}** (${d.xp} XP)`).join('\n') || 'Belum ada data.';
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Gold).setTitle('🏆 Leaderboard').setDescription(desc)] });
      }
      case 'poll': {
        const q = options.getString('question');
        const opts = [];
        const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        for (let i = 1; i <= 10; i++) {
          const v = options.getString(`op${i}`);
          if (v) opts.push(v);
        }
        if (opts.length < 2) return interaction.reply({ content: '❌ Minimal 2 opsi.', ephemeral: true });
        const embed = new EmbedBuilder().setColor(Colors.Blurple).setTitle('📊 ' + q).setDescription(opts.map((o, i) => `${emoji[i]} ${o}`).join('\n')).setFooter({ text: `Polling oleh ${interaction.user.username}` });
        const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
        for (let i = 0; i < opts.length; i++) await msg.react(emoji[i]);
        return;
      }
      case 'ticket': {
        const sub = options.getSubcommand();
        if (sub === 'setup') {
          if (!canManage(interaction)) return interaction.reply({ content: '❌ Kamu tidak punya izin admin.', ephemeral: true });
          const cat = cfg.ticketCategory ? guild.channels.cache.get(cfg.ticketCategory) : null;
          if (!cat || cat.type !== ChannelType.GuildCategory) return interaction.reply({ content: '❌ Kategori ticket belum diatur. Admin: `/setup ticket`', ephemeral: true });
          const cats = (cfg.ticketCategories && cfg.ticketCategories.length) ? cfg.ticketCategories : TICKET_CATEGORIES;
          const row = { type: 1, components: [{ type: 3, customId: 'ticket_cat', placeholder: 'Pilih kategori tiket...', min_values: 1, max_values: 1, options: cats.map(c => ({ label: c.label || c.value, value: c.value, description: c.description || undefined, emoji: c.emoji ? { name: c.emoji } : undefined })) }] };
          const embed = new EmbedBuilder().setColor(Colors.Green).setTitle('🎫 Buat Tiket Bantuan').setDescription('Pilih kategori di menu bawah. Channel tiket pribadi akan dibuat otomatis untukmu.').setFooter({ text: 'MahiStream Bot • Sistem tiket' });
          await interaction.channel.send({ embeds: [embed], components: [row] });
          return interaction.reply({ content: '✅ Panel tiket dipasang di channel ini.', ephemeral: true });
        }
        const reason = options.getString('reason') || 'Tidak ada topik';
        try {
          const r = await createTicket(interaction, 'Bantuan Umum', 'Command /ticket');
          return interaction.reply({ content: r.ok ? `✅ Ticket dibuat: <#${r.id}>\nTopik: ${reason}` : r.msg, ephemeral: true });
    if (commandName === 'changelog') {
      const cl = [
        'Server dipindah ke cloud baru (Railway), lebih cepat & stabil',
        'Login wajib pakai akun Google (tanpa akun tamu)',
        'Halaman detail anime diperbaiki, tidak error lagi',
        'Mode offline diperbaiki, unduhan bisa disimpan ke HP/laptop',
        'Maintenance mode realtime, akun pemilik/admin/dev bebas saat maintenance',
        'Bot Telegram & Bot Discord resmi aktif',
        'Tampilan dibersihkan, logo resmi tanpa emoji',
        'Semua versi diseragamkan ke 2.1.0 (aplikasi & web)'
      ].map(x => '- ' + x).join('\n');
      const embed = new EmbedBuilder().setColor(Colors.Gold).setTitle('Changelog MahiStream v2.1.0')
        .setDescription(cl).setFooter({ text: 'MahiStream • Agustus 2026' });
      return interaction.reply({ embeds: [embed] });
    }
  } catch (e) {
          return interaction.reply({ content: '❌ Gagal membuat tiket: ' + e.message, ephemeral: true });
        }
      }
      case 'remind': {
        const time = options.getString('time');
        const text = options.getString('text');
        const m = time.match(/^(\d+)(s|m|h|d)$/);
        if (!m) return interaction.reply({ content: '❌ Format waktu: contoh `10m`, `1h`, `2d`', ephemeral: true });
        const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
        const ms = parseInt(m[1]) * mult;
        setTimeout(() => interaction.user.send(`⏰ **Reminder!**\n${text}`).catch(() => {}), ms);
        return interaction.reply({ content: `✅ Akan diingatkan dalam **${time}**.`, ephemeral: true });
      }
      case 'filter': {
        const sub = options.getSubcommand();
        if (sub === 'add') {
          const w = options.getString('word').toLowerCase();
          if (!cfg.filterWords.includes(w)) cfg.filterWords.push(w);
          saveGuildConfig(guild.id);
          return interaction.reply({ content: `✅ Kata \`${w}\` ditambahkan ke filter (total ${cfg.filterWords.length}).`, ephemeral: true });
        }
        if (sub === 'remove') {
          cfg.filterWords = cfg.filterWords.filter(x => x !== options.getString('word').toLowerCase());
          saveGuildConfig(guild.id);
          return interaction.reply({ content: '✅ Kata dihapus dari filter.', ephemeral: true });
        }
        return interaction.reply({ content: cfg.filterWords.length ? `📋 Kata terfilter: \`${cfg.filterWords.join('`, `')}\`` : '📭 Belum ada kata terfilter.', ephemeral: true });
      }
      case 'backup': {
        const sub = options.getSubcommand();
        if (sub === 'create') {
          const b = await createBackup(guild, 'manual');
          await logEvent(guild, '💾 Backup dibuat', `Snapshot **${b.id}** (${b.roles.length} role, ${b.channels.length} channel) oleh <@${interaction.user.id}>.`, Colors.Blue);
          return interaction.reply({ content: `✅ Backup **${b.id}** dibuat (${b.roles.length} role, ${b.channels.length} channel).`, ephemeral: true });
        }
        if (sub === 'list') {
          const list = (st.backups || []).slice(0, 5).map(b => `\`${b.id}\` — ${b.label} (<t:${Math.floor(b.at / 1000)}:R>)`).join('\n') || 'Belum ada backup.';
          return interaction.reply({ content: `💾 **Backup terbaru:**\n${list}`, ephemeral: true });
        }
        const b = await restoreBackup(guild, options.getString('id'));
        if (!b) return interaction.reply({ content: '❌ Snapshot tidak ditemukan.', ephemeral: true });
        return interaction.reply({ content: `✅ Restore selesai dari ${b.id}.`, ephemeral: true });
      }
      case 'rr': {
        const sub = options.getSubcommand();
        const msgId = options.getString('messageid');
        if (sub === 'add') {
          const emoji = options.getString('emoji');
          const role = options.getRole('role');
          if (!st.reactionRoles[msgId]) st.reactionRoles[msgId] = [];
          st.reactionRoles[msgId].push({ emoji, role: role.id });
          saveGuildStorage(guild.id);
          try {
            const msg = await interaction.channel.messages.fetch(msgId);
            await msg.react(emoji);
          } catch {}
          return interaction.reply({ content: `✅ Reaction role: \`${emoji}\` -> <@&${role.id}> di pesan ${msgId}.`, ephemeral: true });
        }
        if (sub === 'remove') {
          const emoji = options.getString('emoji');
          if (st.reactionRoles[msgId]) st.reactionRoles[msgId] = st.reactionRoles[msgId].filter(r => r.emoji !== emoji);
          saveGuildStorage(guild.id);
          return interaction.reply({ content: '✅ Reaction role dihapus.', ephemeral: true });
        }
        const list = (st.reactionRoles[msgId] || []).map(r => `\`${r.emoji}\` -> <@&${r.role}>`).join('\n') || 'Belum ada.';
        return interaction.reply({ content: `📋 Reaction roles pesan ${msgId}:\n${list}`, ephemeral: true });
      }
    }
    if (commandName === 'afk') {
      const reason = options.getString('reason') || 'AFK';
      if (st.afk && st.afk[interaction.user.id]) {
        delete st.afk[interaction.user.id];
        saveGuildStorage(guild.id);
        return interaction.reply({ content: '👋 Selamat datang kembali! Status AFK dihapus.', ephemeral: true });
      }
      st.afk = st.afk || {};
      st.afk[interaction.user.id] = { reason, at: Date.now() };
      saveGuildStorage(guild.id);
      return interaction.reply({ content: `😴 Kamu sekarang AFK: **${reason}**`, ephemeral: true });
    }
    if (commandName === 'snipe') {
      if (options.getString('action') === 'clear') {
        if (!canManage(interaction)) return interaction.reply({ content: '❌ Tidak punya izin admin.', ephemeral: true });
        if (st.snipe) delete st.snipe[interaction.channel.id];
        saveGuildStorage(guild.id);
        return interaction.reply({ content: '✅ Snipe dibersihkan.', ephemeral: true });
      }
      const s = st.snipe && st.snipe[interaction.channel.id];
      if (!s) return interaction.reply({ content: '📭 Tidak ada pesan yang dihapus di channel ini.', ephemeral: true });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Grey).setAuthor({ name: s.author, iconURL: s.avatar }).setDescription(s.content || '*[embed/sticker]*').setFooter({ text: `Dihapus <t:${Math.floor(s.at / 1000)}:R>` })] });
    }
    if (commandName === '8ball') {
      const answers = ['Ya', 'Tidak', 'Mungkin', 'Pasti bisa!', 'Jangan dulu', 'Tentu saja', 'Kurang tahu, coba lagi', '100% iya', 'Sepertinya tidak', 'Semoga saja'];
      const q = options.getString('question');
      return interaction.reply({ content: `🎱 **${q}**\n➡️ ${answers[Math.floor(Math.random() * answers.length)]}` });
    }
    if (commandName === 'dice') {
      const sides = Math.min(Math.max(options.getInteger('sides') || 6, 2), 100);
      return interaction.reply({ content: `🎲 Hasil dadu **${Math.floor(Math.random() * sides) + 1}** dari d${sides}` });
    }
    if (commandName === 'coinflip') {
      const r = Math.random() < 0.5 ? 'Kepala (Heads)' : 'Ekor (Tails)';
      return interaction.reply({ content: `🪙 Koin berputar... **${r}**` });
    }
    if (commandName === 'roll') {
      const max = Math.min(Math.max(options.getInteger('max') || 100, 2), 100000);
      return interaction.reply({ content: `🎯 Angka acak: **${Math.floor(Math.random() * max) + 1}** (1-${max})` });
    }
    if (commandName === 'joke') {
      const jokes = ['Kenapa wifi tidak mau makan? Karena ada tempe... TEMPE-tensi tinggi!', 'Kenapa komputer kedinginan? Karena lupa nutup WINDOWS-nya!', 'Apa bedanya kamu sama kulkas? Kulkas tetap dingin walau dibuka, kamu pura-pura dingin walau suka sama aku.', 'Kenapa buku tidak suka dipeluk? Karena takut SPOILER!', 'Apa persamaan matematika dan cinta? Sama-sama butuh HITUNG-hitungan biar tidak salah.', 'Kenapa anime isekai selalu kena truk? Karena kalau kena BECAK, maunya pulang ke rumah dulu.', 'Apa yang dikatakan 0 kepada 8? Sabukmu bagus!', 'Kenapa programmer malas mandi? Karena suka hidup di DUNIA BINARY: 0 dan 1.', 'Apa bahasa Inggrisnya nasi? Rice. Kalau nasi lemak? Rice... lemaq.', 'Kenapa sinyal malam sering jelek? Karena sinyalnya juga lagi ISTIRAHAT.'];
      return interaction.reply({ content: `😂 ${jokes[Math.floor(Math.random() * jokes.length)]}` });
    }
    if (commandName === 'quote') {
      const quotes = ['Jangan tunda sampai besok apa yang bisa kamu tonton hari ini.', 'Hidup itu seperti anime: kadang ada filler, tapi tetap ada alurnya.', 'Orang sukses adalah mereka yang tetap nonton sampai credit roll.', 'Berhenti tidak berarti kalah, terkadang itu jeda untuk recharge.', 'Impian itu seperti episode baru: selalu ada lanjutannya.', 'Kegagalan hanyalah cliffhanger sebelum season berikutnya.', 'Sedikit demi sedikit, seperti membangun skill level, pasti naik.', 'Yang penting bukan cepat sampai, tapi tidak berhenti menonton.', 'Main character energy: yakin pada dirimu sendiri.', 'Setiap hari adalah kesempatan untuk restart dan mencoba lagi.'];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Gold).setDescription(`"${quotes[Math.floor(Math.random() * quotes.length)]}"`) ] });
    }
    if (commandName === 'embed') {
      const title = options.getString('title');
      const desc = options.getString('description');
      await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle(title).setDescription(desc).setFooter({ text: `Oleh ${interaction.user.username}` })] });
      return interaction.reply({ content: '✅ Embed terkirim.', ephemeral: true });
    }
    if (commandName === 'say') {
      const text = options.getString('message');
      await interaction.channel.send(text);
      return interaction.reply({ content: '✅ Pesan terkirim.', ephemeral: true });
    }
    if (commandName === 'timer') {
      const mins = options.getInteger('minutes');
      const text = options.getString('text');
      setTimeout(async () => {
        try { await interaction.channel.send(`⏰ <@${interaction.user.id}> Timer **${mins} menit** selesai!\n${text}`); } catch {}
      }, mins * 60000);
      return interaction.reply({ content: `⏰ Timer **${mins} menit** diset, nanti diingatkan di channel ini.`, ephemeral: true });
    }
    if (commandName === 'randomanime') {
      const list = ['One Piece', 'Jujutsu Kaisen', 'Demon Slayer', 'Attack on Titan', 'Oshi no Ko', 'Frieren', 'Solo Leveling', 'Chainsaw Man', 'Spy x Family', 'Bocchi the Rock!', 'Vinland Saga', 'Kaguya-sama', 'Re:Zero', 'Steins;Gate', 'Fullmetal Alchemist'];
      return interaction.reply({ content: `🎬 Rekomendasi anime hari ini: **${list[Math.floor(Math.random() * list.length)]}**!` });
    }
  } catch (e) {
    console.error('Command error:', commandName, e.message);
    return interaction.reply({ content: '❌ Terjadi error: ' + e.message, ephemeral: true }).catch(() => {});
  }
});

/* ================= EVENTS ================= */

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  const guild = msg.guild;
  const cfg = getGuildConfig(guild.id);

  const xp = xpForMessage(guild, msg.member);
  if (xp && xp !== null && !cfg.raidMode) {
    if (xp > 0 && Math.random() < 0.15) {
      try {
        const dm = await msg.author.send(`🎉 Level up! Kamu naik ke level **${xp}** di ${guild.name}!`).catch(() => null);
        void dm;
      } catch {}
    }
  }

  const isAnnouncement = msg.channel.type === ChannelType.GuildAnnouncement ||
    (msg.channel.name && (msg.channel.name.toLowerCase().includes('announcement') || msg.channel.name.toLowerCase().includes('pengumuman')));
  const isBypass = isTrusted(guild, msg.author.id) ||
    (msg.member && msg.member.permissions && msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) ||
    isAnnouncement;

  if (!isBypass) {
    const hits = checkFilter(guild.id, msg.content);
    if (hits.length) {
      await msg.delete().catch(() => {});
      await logEvent(guild, '🚫 Kata terfilter', `Pesan <@${msg.author.id}> di <#${msg.channel.id}> dihapus.\nKata: \`${hits.join('`, `')}\``, Colors.Red);
      await warnUser(guild, msg.member, `Kata terlarang: ${hits.join(', ')}`, client.user.id);
      return;
    }

    if (checkSpam(guild.id, msg.member, msg.content)) {
      await msg.delete().catch(() => {});
      await msg.member.timeout(10000, 'Spam').catch(() => {});
      await logEvent(guild, '⚠️ Anti-spam', `<@${msg.author.id}> di-mute 10 detik karena spam di <#${msg.channel.id}>.`, Colors.Yellow);
    }

    const rl = msg.content.toLowerCase();
    const nsfw = RULE_WORDS.find(w => {
      if (w.length <= 4) {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return re.test(rl);
      }
      return rl.includes(w);
    });
    if (nsfw) {
      await msg.delete().catch(() => {});
      await logEvent(guild, '🚫 Rule 3: Konten NSFW', `Pesan <@${msg.author.id}> di <#${msg.channel.id}> dihapus.\nKata: \`${nsfw}\``, Colors.Red);
      await warnUser(guild, msg.member, `Melanggar Rule 3 (konten NSFW): ${nsfw}`, client.user.id);
      return;
    }
    const inv = [...msg.content.matchAll(RULE_INVITE_RE)];
    if (inv.length) {
      const own = cfg.inviteCode ? inv.some(m => m[1].toLowerCase() === cfg.inviteCode.toLowerCase()) : false;
      if (!own) {
        await msg.delete().catch(() => {});
        await logEvent(guild, '🚫 Rule 4: Link undangan', `Pesan <@${msg.author.id}> di <#${msg.channel.id}> dihapus.\nLink: \`${inv[0][0]}\``, Colors.Red);
        await warnUser(guild, msg.member, `Melanggar Rule 4 (self-promote): ${inv[0][0]}`, client.user.id);
        return;
      }
    }
  }

  const st = getGuildStorage(guild.id);
  if (st.afk && st.afk[msg.author.id]) {
    delete st.afk[msg.author.id];
    saveGuildStorage(guild.id);
    await msg.reply('👋 Selamat datang kembali! Status AFK dihapus.').catch(() => {});
  }
  const afkTarget = msg.mentions.users.find(u => u.id !== client.user.id && st.afk && st.afk[u.id]);
  if (afkTarget) {
    const d = st.afk[afkTarget.id];
    await msg.reply(`😴 **${afkTarget.username}** sedang AFK sejak <t:${Math.floor(d.at / 1000)}:R>\n📝 ${d.reason}`).catch(() => {});
  }
});

client.on(Events.MessageDelete, async (msg) => {
  if (!msg.guild || !msg.content || msg.author?.bot) return;
  const st = getGuildStorage(msg.guild.id);
  st.snipe = st.snipe || {};
  st.snipe[msg.channel.id] = { author: msg.author.tag, avatar: msg.author.displayAvatarURL(), content: msg.content.slice(0, 1000), at: Date.now() };
  saveGuildStorage(msg.guild.id);
  await logEvent(msg.guild, '🗑️ Pesan dihapus', `Pesan <@${msg.author.id}> di <#${msg.channel.id}>:\n\`\`\`${msg.content.slice(0, 500)}\`\`\``, Colors.Grey);
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  await logEvent(oldMsg.guild, '✏️ Pesan diedit', `Oleh <@${oldMsg.author.id}> di <#${oldMsg.channel.id}>\n**Sebelum:** \`\`\`${(oldMsg.content || '').slice(0, 400)}\`\`\`\n**Sesudah:** \`\`\`${(newMsg.content || '').slice(0, 400)}\`\`\``, Colors.Blue);
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  await welcomeMember(member);
  await logEvent(member.guild, '📥 Member masuk', `<@${member.user.id}> bergabung. Total: **${member.guild.memberCount}** member.`, Colors.Green);
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (member.user.bot) return;
  await farewellMember(member);
  await logEvent(member.guild, '📤 Member keluar', `<@${member.user.id}> (${member.user.username}) meninggalkan server.`, Colors.Grey);
  try {
    const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 3 });
    const kick = logs.entries.find(e => e.targetId === member.id && Date.now() - e.createdTimestamp < 20000);
    if (kick && !isTrusted(member.guild, kick.executor.id)) {
      await antiNukeCheck(member.guild, 'kick');
    }
  } catch {}
});

client.on(Events.GuildBanAdd, async (ban) => {
  await antiNukeCheck(ban.guild, 'ban');
});

client.on(Events.ChannelDelete, async (ch) => {
  if (!ch.guild) return;
  await antiNukeCheck(ch.guild, 'channel');
  await logEvent(ch.guild, '❌ Channel dihapus', `Channel **${ch.name}** (${ch.type}) dihapus.`, Colors.Red);
});

client.on(Events.ChannelCreate, async (ch) => {
  if (!ch.guild) return;
  await logEvent(ch.guild, '✅ Channel dibuat', `Channel **${ch.name}** (${ch.type}) dibuat.`, Colors.Green);
});

client.on(Events.RoleDelete, async (role) => {
  if (!role.guild) return;
  await antiNukeCheck(role.guild, 'role');
  await logEvent(role.guild, '❌ Role dihapus', `Role **${role.name}** dihapus.`, Colors.Red);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.user.bot) return;
  if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
    if (newMember.communicationDisabledUntil) {
      await logEvent(newMember.guild, '🔇 Timeout', `<@${newMember.user.id}> di-mute sampai <t:${Math.floor(newMember.communicationDisabledUntil / 1000)}:R>.`, Colors.Orange);
    } else {
      await logEvent(newMember.guild, '🔊 Timeout selesai', `<@${newMember.user.id}> tidak lagi di-mute.`, Colors.Green);
    }
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!oldState.channelId && newState.channelId) {
    await logEvent(newState.guild, '🎙️ Voice join', `<@${newState.member.user.id}> masuk **${newState.channel.name}**.`, Colors.Blurple);
  } else if (oldState.channelId && !newState.channelId) {
    await logEvent(newState.guild, '🎙️ Voice leave', `<@${newState.member.user.id}> keluar dari **${oldState.channel.name}**.`, Colors.Blurple);
  }
});

client.on(Events.MessageReactionAdd, handleReactionAdd);
client.on(Events.MessageReactionRemove, handleReactionRemove);

client.login(cfgFile.token).catch(e => { console.error('Login gagal:', e.message); process.exit(1); });

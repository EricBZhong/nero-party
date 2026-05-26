import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAudioPlayer, createAudioResource, joinVoiceChannel, NoSubscriberBehavior } from "@discordjs/voice";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import type { PartyState, Track } from "@nero/shared";

const dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dirname, "../../../.env") });
dotenv.config();

const env = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? "",
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? "",
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID ?? "",
  NERO_API_URL: process.env.NERO_API_URL ?? "http://localhost:3000",
  NERO_WEB_URL: process.env.NERO_WEB_URL ?? "http://localhost:5173",
  DISCORD_BOT_SECRET: process.env.DISCORD_BOT_SECRET ?? "",
};

const commands = [
  new SlashCommandBuilder()
    .setName("nero")
    .setDescription("Run a Nero Party room")
    .addSubcommand((command) =>
      command
        .setName("create")
        .setDescription("Create and link a Nero room")
        .addStringOption((option) => option.setName("title").setDescription("Room title").setMaxLength(80))
        .addBooleanOption((option) => option.setName("voice").setDescription("Enable Discord voice playback")),
    )
    .addSubcommand((command) =>
      command
        .setName("join")
        .setDescription("Get the linked room")
        .addStringOption((option) => option.setName("code").setDescription("Optional room code").setMaxLength(8)),
    )
    .addSubcommand((command) => command.setName("now").setDescription("Show the current song"))
    .addSubcommand((command) => command.setName("save").setDescription("Open the save action for the current song"))
    .addSubcommand((command) => command.setName("top3").setDescription("Open your Top 3"))
    .addSubcommand((command) => command.setName("queue").setDescription("Show the room queue"))
    .addSubcommand((command) => command.setName("open").setDescription("Open the Discord Activity or web room"))
    .addSubcommand((command) => command.setName("end").setDescription("Lock the room finale")),
].map((command) => command.toJSON());

if (process.argv.includes("--register-only")) {
  await registerCommands();
  process.exit(0);
}

if (!env.DISCORD_TOKEN || !env.DISCORD_CLIENT_ID) {
  console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required for @nero/discord-bot.");
  process.exit(1);
}

await registerCommands();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.on("ready", () => {
  console.log(`Nero bot signed in as ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "nero") {
      await handleNeroCommand(interaction);
      return;
    }
    if (interaction.isButton()) {
      await interaction.reply({
        ephemeral: true,
        content: buttonCopy(interaction.customId),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nero could not complete that action.";
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ ephemeral: true, content: message });
    }
  }
});

await client.login(env.DISCORD_TOKEN);

async function handleNeroCommand(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  if (!interaction.guildId) {
    await interaction.reply({ ephemeral: true, content: "Nero rooms need a Discord server context." });
    return;
  }

  if (subcommand === "create") {
    const title = interaction.options.getString("title") ?? `${interaction.guild?.name ?? "Nero"} listening party`;
    const allowDiscordVoice = interaction.options.getBoolean("voice") ?? true;
    const created = await api<{ partyCode: string; participantToken: string; state: PartyState }>("/api/parties", {
      method: "POST",
      body: JSON.stringify({
        title,
        hostName: interaction.user.globalName ?? interaction.user.username,
        mode: "companion",
        settings: {
          maxSubmissionsPerParticipant: 3,
          maxQueueSize: 24,
          votingLockSeconds: 90,
          allowDiscordVoice,
          allowUploads: true,
          allowAudius: true,
          allowSpotify: true,
        },
      }),
    });
    await linkGuild(interaction.guildId, created.state.party.id);
    await interaction.reply({
      embeds: [roomEmbed(created.state, "Room created")],
      components: [roomButtons(created.state.party.code)],
    });
    return;
  }

  if (subcommand === "join") {
    const code = interaction.options.getString("code");
    if (code) {
      const state = await api<PartyState>(`/api/parties/${encodeURIComponent(code)}`);
      await linkGuild(interaction.guildId, state.party.id);
      await interaction.reply({ embeds: [roomEmbed(state, "Room linked")], components: [roomButtons(state.party.code)] });
      return;
    }
    const state = await linkedState(interaction.guildId);
    await interaction.reply({ embeds: [roomEmbed(state, "Join room")], components: [roomButtons(state.party.code)] });
    return;
  }

  if (subcommand === "now") {
    const state = await linkedState(interaction.guildId);
    await interaction.reply({ embeds: [roomEmbed(state, "Now playing")], components: [roomButtons(state.party.code)] });
    return;
  }

  if (subcommand === "queue") {
    const state = await linkedState(interaction.guildId);
    const queue = state.tracks
      .filter((track) => track.status === "queued")
      .slice(0, 8)
      .map((track) => `${track.queuePosition}. ${track.title} - ${track.artist}`)
      .join("\n");
    await interaction.reply({
      ephemeral: true,
      content: queue || "The Nero queue is empty.",
      components: [roomButtons(state.party.code)],
    });
    return;
  }

  if (subcommand === "open" || subcommand === "save" || subcommand === "top3") {
    const state = await linkedState(interaction.guildId);
    await interaction.reply({
      ephemeral: true,
      content: subcommand === "save" ? "Open Nero, then press Save on the current song." : subcommand === "top3" ? "Open Nero to edit your Top 3." : "Open Nero.",
      components: [roomButtons(state.party.code)],
    });
    return;
  }

  if (subcommand === "end") {
    const state = await linkedState(interaction.guildId);
    await interaction.reply({
      ephemeral: true,
      content: `Finale locks from the host controls in Nero. Room: ${roomUrl(state.party.code)}`,
      components: [roomButtons(state.party.code)],
    });
    return;
  }
}

function roomEmbed(state: PartyState, title: string) {
  const currentTrack = state.tracks.find((track) => track.id === state.playback.currentTrackId);
  return new EmbedBuilder()
    .setColor(0x31f176)
    .setTitle(`Nero Party: ${title}`)
    .setDescription(`**${state.party.title}**\n${currentTrack ? trackLine(currentTrack) : "No song is playing yet."}`)
    .addFields(
      { name: "Code", value: state.party.code, inline: true },
      { name: "People", value: String(state.participants.length), inline: true },
      { name: "Queue", value: String(state.tracks.filter((track) => track.status === "queued").length), inline: true },
    );
}

function roomButtons(code: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`nero:save:${code}`).setLabel("Save").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`nero:top3:${code}`).setLabel("Top 3").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("Open Activity").setStyle(ButtonStyle.Link).setURL(roomUrl(code)),
    new ButtonBuilder().setCustomId(`nero:queue:${code}`).setLabel("Show Queue").setStyle(ButtonStyle.Secondary),
  );
}

function buttonCopy(customId: string) {
  if (customId.startsWith("nero:save")) return "Open Nero and press Save. Discord button writes need the Activity identity token in private beta.";
  if (customId.startsWith("nero:top3")) return "Open Nero to move the current song into your Top 3.";
  if (customId.startsWith("nero:queue")) return "Use /nero queue for the latest queue snapshot.";
  return "Open Nero to continue.";
}

async function playCurrentTrackInVoice(interaction: ChatInputCommandInteraction, state: PartyState) {
  const member = await interaction.guild?.members.fetch(interaction.user.id);
  const channel = member?.voice.channel;
  const currentTrack = state.tracks.find((track) => track.id === state.playback.currentTrackId);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Join a voice channel first.");
  if (!currentTrack?.streamUrl) throw new Error("The current song does not have a playable upload or Audius stream.");
  if (currentTrack.sourceType === "youtube_embed") throw new Error("Nero does not stream hidden audio from video platforms.");

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  player.play(createAudioResource(currentTrack.streamUrl));
  connection.subscribe(player);
}

function trackLine(track: Track) {
  return `${track.title} - ${track.artist}`;
}

function roomUrl(code: string) {
  return `${env.NERO_WEB_URL}/discord/${encodeURIComponent(code)}`;
}

async function linkedState(guildId: string) {
  const payload = await api<{ state: PartyState }>(`/api/discord/guilds/${guildId}/party`);
  return payload.state;
}

async function linkGuild(guildId: string, partyId: string) {
  await api(`/api/discord/guilds/${guildId}/party`, {
    method: "POST",
    body: JSON.stringify({ partyId }),
  });
}

async function api<T>(pathName: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.NERO_API_URL}${pathName}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(env.DISCORD_BOT_SECRET ? { Authorization: `Bearer ${env.DISCORD_BOT_SECRET}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Nero API failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

async function registerCommands() {
  if (!env.DISCORD_TOKEN || !env.DISCORD_CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  if (env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commands });
  }
  console.log("Nero slash commands registered.");
}

export { playCurrentTrackInVoice };

/**
 * Discord Interactions Cloudflare Worker
 * Wires /link and /unlink to your Twitch admin API.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
  InteractionResponseFlags, // imported for parity with sample (not used: we send public messages)
} from 'discord-interactions';
import { LINK_COMMAND, UNLINK_COMMAND } from './commands.js';

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || { headers: { 'content-type': 'application/json;charset=UTF-8' } };
    super(jsonBody, init);
  }
}

const router = AutoRouter();
const ADMIN_BASE = 'https://twitch.budgiebailey.workers.dev';

// Only these Discord user IDs can run /link and /unlink
const ADMIN_USER_IDS = [
  '1356193903497318542', // you
  // '123456789012345678', // add more here
];

/* ---------------- Helpers ---------------- */

function getInvokerId(interaction) {
  return interaction?.member?.user?.id || interaction?.user?.id || '';
}

function isAuthorized(interaction) {
  const id = getInvokerId(interaction);
  return ADMIN_USER_IDS.includes(String(id));
}

function getOption(interaction, name) {
  const opts = interaction?.data?.options;
  if (!Array.isArray(opts)) return undefined;
  const found = opts.find((o) => o?.name === name);
  return found?.value;
}

async function postJSON(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}${data ? `: ${JSON.stringify(data)}` : ''}`);
  }
  return data;
}

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature && timestamp && (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }
  return { interaction: JSON.parse(body), isValid: true };
}

/* ---------------- Routes ---------------- */

/**
 * Simple hello page to verify the worker is up.
 */
router.get('/', (_req, env) => new Response(`👋 ${env.DISCORD_APPLICATION_ID || ''}`));

/**
 * Main Discord interactions endpoint
 */
router.post('/', async (request, env) => {
  const { isValid, interaction } = await verifyDiscordRequest(request, env);
  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  // Handshake
  if (interaction.type === InteractionType.PING) {
    return new JsonResponse({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Only allow whitelisted users to use these admin-ish commands
    if (!isAuthorized(interaction)) {
      const who = getInvokerId(interaction);
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `⛔ Not authorised (<@${who}>).` },
      });
    }

    switch (String(interaction.data.name || '').toLowerCase()) {
      case String(LINK_COMMAND.name).toLowerCase(): {
        try {
          // Expected required options on your command:
          //   - twitch_login (STRING)  // or legacy 'login'
          //   - discord_user (USER)
          const loginOpt = getOption(interaction, 'twitch_login') ?? getOption(interaction, 'login'); // support old name
          const discordUserOpt = getOption(interaction, 'discord_user'); // USER option resolves to a user ID

          const login = String(loginOpt ?? '').trim().toLowerCase();
          const discordUserId = String(discordUserOpt ?? '').trim();

          if (!login || !discordUserId) {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: '❌ Missing required options. Example: `/link twitch_login:cxrys_ discord_user:@User`',
              },
            });
          }

          const payload = { login, discord_user_id: discordUserId };
          const res = await postJSON(`${ADMIN_BASE}/admin/register`, env.ADMIN_TOKEN, payload);

          const created = Array.isArray(res.created) && res.created.length ? ` (created: ${res.created.join(', ')})` : '';

          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `✅ Linked **${login}** → <@${discordUserId}>\nTwitch ID: \`${res.twitch_id ?? 'unknown'}\`${created}`,
            },
          });
        } catch (err) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `❌ Link failed: \`${(err && err.message) || err}\`` },
          });
        }
      }

      case String(UNLINK_COMMAND.name).toLowerCase(): {
        try {
          // Accept either:
          //   - twitch_login (STRING) / legacy 'login'
          //   - broadcaster_id (STRING)
          const loginOpt = getOption(interaction, 'twitch_login') ?? getOption(interaction, 'login');
          const bidOpt = getOption(interaction, 'broadcaster_id');

          if (!loginOpt && !bidOpt) {
            return new JsonResponse({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content:
                  '❌ Provide `twitch_login` **or** `broadcaster_id`.\n' +
                  'Examples:\n• `/unlink twitch_login:cxrys_`\n• `/unlink broadcaster_id:564886943`',
              },
            });
          }

          const payload = {};
          if (loginOpt) payload.login = String(loginOpt).trim().toLowerCase();
          if (bidOpt) payload.broadcaster_id = String(bidOpt).trim();

          const res = await postJSON(`${ADMIN_BASE}/admin/unregister`, env.ADMIN_TOKEN, payload);

          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `✅ Unlinked Twitch ID \`${res?.broadcaster_id || payload.broadcaster_id || 'unknown'}\` (EventSub removed, mapping cleared)`,
            },
          });
        } catch (err) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `❌ Unlink failed: \`${(err && err.message) || err}\`` },
          });
        }
      }

      default:
        return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  // Fallback
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

/* --------- Export (keep single declaration for ESM) --------- */

const server = {
  fetch: router.fetch,
  verifyDiscordRequest, // exported for parity with sample (not used externally by CF)
};

export default server;

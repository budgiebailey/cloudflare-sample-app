/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */

export const LINK_COMMAND = {
  name: 'link',
  description: 'Links a Discord User to their Twitch Profile. Provisions access for stream alerts.',
  options: [
    {
      name: 'login',
      description: 'Twitch username (login) to link',
      type: 3, // STRING
      required: true,
    },
    {
      name: 'discord_user',
      description: 'Discord user to link to this Twitch account.',
      type: 6, // USER
      required: true,
    },
  ],
};

export const UNLINK_COMMAND = {
  name: 'unlink',
  description: 'Unlinks a Discord User from their Twitch Profile. Unprovisions access for stream alerts.',
  options: [
    {
      name: 'login',
      description: 'Twitch username (login) to unlink',
      type: 3, // STRING
      required: false,
    },
    {
      name: 'broadcaster_id',
      description: 'Twitch broadcaster ID to unlink (alternative to login)',
      type: 3, // STRING
      required: false,
    },
  ],
};

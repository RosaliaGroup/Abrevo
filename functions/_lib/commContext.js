'use strict';
/**
 * Production wiring for the Communications system. Builds the repo + services
 * from ENVIRONMENT variables only. Never returns or logs credentials. Used by
 * the Netlify handlers; unit tests wire fakes/mocks directly instead.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, TELNYX_API_KEY, TELNYX_FROM_NUMBER,
 *      TELNYX_PUBLIC_KEY (webhooks).
 */

const { createSupabaseRepo } = require('./supabaseRepo');
const { createConversationService } = require('./conversations');
const { createTelnyxClient } = require('./telnyx');
const { createSmsService } = require('./smsService');
const { createCommApi } = require('./commApi');
const { createSmsWebhookProcessor } = require('./smsWebhook');

function createCommContext() {
  const repo = createSupabaseRepo(); // reads SUPABASE_URL / SUPABASE_SERVICE_KEY
  const conversationService = createConversationService({ repo });
  const telnyx = createTelnyxClient(); // reads TELNYX_API_KEY / TELNYX_FROM_NUMBER
  const smsService = createSmsService({ conversationService, repo, telnyx });
  const commApi = createCommApi({ repo, conversationService, smsService });
  const webhook = createSmsWebhookProcessor({ repo, conversationService });
  return { repo, conversationService, telnyx, smsService, commApi, webhook };
}

module.exports = { createCommContext };

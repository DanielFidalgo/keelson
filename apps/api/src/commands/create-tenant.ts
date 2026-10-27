import { loadApiConfig } from '../config.js';
import { createApiContainer } from '../container.js';
import { chooseApiKeyHandoff } from './api-key-handoff.js';
import { parseCreateTenantArguments } from './arguments.js';
import { runCommand } from './run-command.js';

await runCommand(async () => {
  const { name, recipientKey } = parseCreateTenantArguments(process.argv.slice(2));
  // isTTY is undefined, not false, when piped; the handoff tests truthiness so that still counts as not a terminal.
  const handoff = chooseApiKeyHandoff({ recipientKey, stdoutIsTerminal: process.stdout.isTTY });
  const container = createApiContainer(loadApiConfig(process.env));
  try {
    const { tenantId, apiKey } = await container.cradle.createTenant.execute({ name });
    // The key is stored only as a hash, so this line is the one chance to copy it.
    console.log(`tenant ${tenantId} created\n${handoff(apiKey)}`);
  } finally {
    await container.dispose();
  }
});

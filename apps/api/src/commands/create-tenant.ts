import { loadApiConfig } from '../config.js';
import { createApiContainer } from '../container.js';
import { parseTenantName } from './arguments.js';
import { runCommand } from './run-command.js';

await runCommand(async () => {
  const name = parseTenantName(process.argv.slice(2));
  const container = createApiContainer(loadApiConfig(process.env));
  try {
    const { tenantId, apiKey } = await container.cradle.createTenant.execute({ name });
    // The key is stored only as a hash, so this line is the one chance to copy it.
    console.log(`tenant ${tenantId} created\napi key (shown once): ${apiKey}`);
  } finally {
    await container.dispose();
  }
});

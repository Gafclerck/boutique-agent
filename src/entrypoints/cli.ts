import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { RodiumClient } from '../adapters/llm/rodium-client.js';
import { SYSTEM_INSTRUCTIONS } from '../agent/instructions.js';
import { runAgent } from '../agent/loop.js';
import { formatTrace } from '../agent/trace.js';
import { Shop } from '../domain/shop.js';
import type { ChatMessage } from '../ports/llm-client.js';
import { createDefaultRegistry } from '../tools/registry.js';

async function main(): Promise<void> {
  let llm: RodiumClient;
  try {
    llm = new RodiumClient();
  } catch (err) {
    console.error(
      'Erreur d\'initialisation :',
      err instanceof Error ? err.message : err,
    );
    console.error(
      'Veuillez créer un fichier .env (à partir de .env.example) et définir RODIUM_API_KEY et RODIUM_MODEL.',
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let shop = new Shop();
  let tools = createDefaultRegistry(shop);

  // One-off question mode:
  if (args.length > 0) {
    const userMessage = args.join(' ').trim();
    console.log(`\nClient : ${userMessage}\n`);
    try {
      const result = await runAgent({
        llm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage,
      });

      console.log('--- Trace d\'exécution ---');
      console.log(formatTrace(result.trace));
      console.log('-------------------------\n');
      console.log(`Agent : ${result.reply}\n`);
    } catch (err) {
      console.error('Erreur lors de l\'exécution :', err);
      process.exit(1);
    }
    return;
  }

  // Interactive mode (readline)
  const rl = readline.createInterface({ input, output });
  const history: ChatMessage[] = [];

  console.log('='.repeat(65));
  console.log('  Boutique d\'Afi - Agent Vendeur (Marché Dantokpa, Bénin)');
  console.log('  Commandes spéciales : /reset (réinitialiser) | /quit (quitter)');
  console.log('='.repeat(65) + '\n');

  try {
    while (true) {
      const userInput = await rl.question('Client > ');
      const trimmed = userInput.trim();

      if (!trimmed) continue;

      if (trimmed === '/quit') {
        console.log('Au revoir et à bientôt chez Afi !');
        break;
      }

      if (trimmed === '/reset') {
        history.length = 0;
        shop = new Shop();
        tools = createDefaultRegistry(shop);
        console.log('\n[Système] Conversation et stock réinitialisés.\n');
        continue;
      }

      try {
        const result = await runAgent({
          llm,
          tools,
          instructions: SYSTEM_INSTRUCTIONS,
          history,
          userMessage: trimmed,
        });

        console.log('\n--- Trace d\'exécution ---');
        console.log(formatTrace(result.trace));
        console.log('-------------------------\n');
        console.log(`Agent > ${result.reply}\n`);

        // result.messages contains the complete conversation including the final assistant reply.
        // Update history with messages after system instruction without duplicate assistant reply.
        history.length = 0;
        history.push(...result.messages.slice(1));
      } catch (err) {
        console.error('\nErreur :', err instanceof Error ? err.message : err, '\n');
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});

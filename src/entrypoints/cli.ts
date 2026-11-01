import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ConsoleApproval } from '../adapters/approval/console-approval.js';
import { RodiumClient } from '../adapters/llm/rodium-client.js';
import { JsonFileStore } from '../adapters/store/json-file-store.js';
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
  const dataFilePath = process.env.SHOP_DATA_FILE ?? 'data/shop.json';
  let store = new JsonFileStore(dataFilePath);
  let shop = new Shop(store);
  let tools = createDefaultRegistry(shop);

  // One-off question mode:
  if (args.length > 0) {
    const userMessage = args.join(' ').trim();
    console.log(`\nClient : ${userMessage}\n`);

    const isInteractive = Boolean(input.isTTY);
    let rlOneOff: readline.Interface | undefined;
    let approval: ConsoleApproval | undefined;

    if (isInteractive) {
      rlOneOff = readline.createInterface({ input, output });
      approval = new ConsoleApproval((q) => rlOneOff!.question(q));
    }

    try {
      const result = await runAgent({
        llm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage,
        approval,
      });

      console.log('--- Trace d\'exécution ---');
      console.log(formatTrace(result.trace));
      console.log('-------------------------\n');
      console.log(`Agent : ${result.reply}\n`);
    } catch (err) {
      console.error('Erreur lors de l\'exécution :', err);
      process.exit(1);
    } finally {
      rlOneOff?.close();
    }
    return;
  }

  // Interactive mode (single readline interface for dialogue & approval)
  const rl = readline.createInterface({ input, output });
  const approval = new ConsoleApproval((question) => rl.question(question));
  const history: ChatMessage[] = [];

  console.log('='.repeat(65));
  console.log('  Boutique d\'Afi - Agent Vendeur (Marché Dantokpa, Bénin)');
  console.log('  Stock persistant : ' + dataFilePath);
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
        store = new JsonFileStore(dataFilePath);
        shop = new Shop(store);
        tools = createDefaultRegistry(shop);
        console.log('\n[Système] Conversation rechargée depuis le magasin persistant.\n');
        continue;
      }

      try {
        const result = await runAgent({
          llm,
          tools,
          instructions: SYSTEM_INSTRUCTIONS,
          history,
          userMessage: trimmed,
          approval,
        });

        console.log('\n--- Trace d\'exécution ---');
        console.log(formatTrace(result.trace));
        console.log('-------------------------\n');
        console.log(`Agent > ${result.reply}\n`);

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

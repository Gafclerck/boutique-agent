import type { Shop } from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import { CalculerTotalTool } from './calculer-total.js';
import { ChercherProduitsTool } from './chercher-produits.js';
import { ConvertirDeviseTool } from './convertir-devise.js';
import { CreerCommandeTool } from './creer-commande.js';
import { FraisLivraisonTool } from './frais-livraison.js';
import type { Tool } from './types.js';
import { VerifierStockTool } from './verifier-stock.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public getAll(): readonly Tool[] {
    return Array.from(this.tools.values());
  }

  public getDefinitions(): readonly ToolDefinition[] {
    return this.getAll().map((tool) => tool.toDefinition());
  }
}

export function createDefaultRegistry(
  shop: Shop,
  fetchFn?: typeof fetch,
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(new ChercherProduitsTool(shop));
  registry.register(new VerifierStockTool(shop));
  registry.register(new FraisLivraisonTool(shop));
  registry.register(new ConvertirDeviseTool(fetchFn));
  registry.register(new CalculerTotalTool(shop));
  registry.register(new CreerCommandeTool(shop));

  return registry;
}

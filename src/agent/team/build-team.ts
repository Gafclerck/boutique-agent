import type { ApprovalPort } from '../../ports/approval.js';
import type { LlmClient } from '../../ports/llm-client.js';
import { Shop } from '../../domain/shop.js';
import { CalculerTotalTool } from '../../tools/calculer-total.js';
import { ChercherProduitsTool } from '../../tools/chercher-produits.js';
import { ConvertirDeviseTool } from '../../tools/convertir-devise.js';
import { CreerCommandeTool } from '../../tools/creer-commande.js';
import { FraisLivraisonTool } from '../../tools/frais-livraison.js';
import { createRegistry, ToolRegistry } from '../../tools/registry.js';
import { VerifierStockTool } from '../../tools/verifier-stock.js';
import { createSpecialistTool } from './specialist-tool.js';
import {
  GERANT_INSTRUCTIONS,
  LOGISTICIEN_INSTRUCTIONS,
  REDACTEUR_INSTRUCTIONS,
  VENDEUR_INSTRUCTIONS,
} from './team-instructions.js';

export interface BuildTeamDeps {
  readonly llm: LlmClient;
  readonly shop?: Shop;
  readonly approval?: ApprovalPort;
  readonly fetchFn?: typeof fetch;
  readonly maxStepsSpecialist?: number;
  readonly maxTokensSpecialist?: number;
  readonly vendeurTools?: ToolRegistry;
  readonly logisticienTools?: ToolRegistry;
  readonly redacteurTools?: ToolRegistry;
}

export interface BuiltTeam {
  readonly instructions: string;
  readonly tools: ToolRegistry;
}

export function buildTeam(deps: BuildTeamDeps): BuiltTeam {
  const shop = deps.shop ?? new Shop();

  // Outils du Vendeur : chercher_produits, verifier_stock, calculer_total, creer_commande
  const vendeurTools =
    deps.vendeurTools ??
    createRegistry([
      new ChercherProduitsTool(shop),
      new VerifierStockTool(shop),
      new CalculerTotalTool(shop),
      new CreerCommandeTool(shop),
    ]);

  // Outils du Logisticien : frais_livraison, convertir_devise
  const logisticienTools =
    deps.logisticienTools ??
    createRegistry([
      new FraisLivraisonTool(shop),
      new ConvertirDeviseTool(deps.fetchFn),
    ]);

  // Outils du Rédacteur : aucun outil
  const redacteurTools = deps.redacteurTools ?? createRegistry([]);

  const demanderAuVendeur = createSpecialistTool({
    name: 'demander_au_vendeur',
    description:
      "Confie une demande au vendeur : recherche de produits, stock, devis (total) et enregistrement d'une commande confirmée. La demande doit être complète et autonome : le vendeur ne connaît pas la conversation. Renvoie un résumé factuel.",
    role: 'vendeur',
    instructions: VENDEUR_INSTRUCTIONS,
    tools: vendeurTools,
    llm: deps.llm,
    approval: deps.approval,
    maxSteps: deps.maxStepsSpecialist,
    maxTokens: deps.maxTokensSpecialist,
    paramName: 'demande',
  });

  const demanderAuLogisticien = createSpecialistTool({
    name: 'demander_au_logisticien',
    description:
      "Confie une demande au logisticien : frais et délai de livraison pour une zone, zones desservies, conversion d'un montant en FCFA vers une autre devise. La demande doit être complète et autonome.",
    role: 'logisticien',
    instructions: LOGISTICIEN_INSTRUCTIONS,
    tools: logisticienTools,
    llm: deps.llm,
    maxSteps: deps.maxStepsSpecialist,
    maxTokens: deps.maxTokensSpecialist,
    paramName: 'demande',
  });

  const demanderAuRedacteur = createSpecialistTool({
    name: 'demander_au_redacteur',
    description:
      "Met en forme la réponse finale pour WhatsApp à partir de faits déjà obtenus des spécialistes. Ne lui transmettre que ces faits. Il n'ajoute aucun fait.",
    role: 'redacteur',
    instructions: REDACTEUR_INSTRUCTIONS,
    tools: redacteurTools,
    llm: deps.llm,
    maxSteps: deps.maxStepsSpecialist,
    maxTokens: deps.maxTokensSpecialist,
    paramName: 'faits',
  });

  // Le Gérant n'a AUCUN autre outil (pas de creer_commande direct)
  const gerantRegistry = createRegistry([
    demanderAuVendeur,
    demanderAuLogisticien,
    demanderAuRedacteur,
  ]);

  return {
    instructions: GERANT_INSTRUCTIONS,
    tools: gerantRegistry,
  };
}

import * as fs from 'node:fs';
import * as path from 'node:path';

const targetPath =
  process.env.SHOP_DATA_FILE ?? path.resolve(process.cwd(), 'data/shop.json');

if (fs.existsSync(targetPath)) {
  fs.unlinkSync(targetPath);
  console.log(`[data:reset] Fichier supprimé : ${targetPath}`);
} else {
  console.log(`[data:reset] Aucun fichier à supprimer : ${targetPath}`);
}

const fs = require('fs');
const path = require('path');

const rustBridgePath = path.resolve(__dirname, '..', 'node_modules', 'whatsapp-rust-bridge', 'package.json');

if (fs.existsSync(rustBridgePath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(rustBridgePath, 'utf8'));
    
    if (pkg.exports && pkg.exports['.']) {
      if (!pkg.exports['.'].require) {
        pkg.exports['.'].require = './dist/index.js';
        pkg.exports['.'].default = './dist/index.js';
        
        fs.writeFileSync(rustBridgePath, JSON.stringify(pkg, null, 4));
        console.log('[PostInstall] whatsapp-rust-bridge corrigido para compatibilidade com ESM/CJS.');
      } else {
        console.log('[PostInstall] whatsapp-rust-bridge já estava corrigido.');
      }
    }
  } catch (err) {
    console.error('[PostInstall] Falha ao corrigir whatsapp-rust-bridge:', err.message);
  }
} else {
  console.log('[PostInstall] whatsapp-rust-bridge não encontrado. Nada a corrigir.');
}

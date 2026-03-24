const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const distPath = path.join(process.cwd(), 'dist');

console.log('🚀 Building production backend (TSC)...');
try {
    // Force clean old dist before build
    if (fs.existsSync(distPath)) {
        fs.rmSync(distPath, { recursive: true, force: true });
    }
    execSync('npx tsc', { stdio: 'inherit' });
    console.log('✅ Backend build completed.');
} catch (e) {
    console.error('❌ TSC Build failed:', e.message);
    process.exit(1);
}

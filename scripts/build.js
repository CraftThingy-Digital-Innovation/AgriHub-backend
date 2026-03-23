const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const distPath = path.join(process.cwd(), 'dist');

if (!fs.existsSync(distPath)) {
    console.log('🚀 Building production backend (TSC)...');
    try {
        execSync('npx tsc', { stdio: 'inherit' });
    } catch (e) {
        console.error('❌ TSC Build failed:', e.message);
        process.exit(1);
    }
} else {
    console.log('✅ Dist folder exists, skipping TSC for production optimization.');
}

import resolveConfig from 'tailwindcss/resolveConfig.js';
import config from './tailwind.config.ts';

const resolved = resolveConfig(config);
console.log('Screens:', JSON.stringify(resolved.theme.screens, null, 2));
console.log('Has lg?', 'lg' in resolved.theme.screens);
console.log('Has md?', 'md' in resolved.theme.screens);
console.log('Has sm?', 'sm' in resolved.theme.screens);

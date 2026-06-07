import { createContext } from 'tailwindcss/src/lib/setupContextUtils.js';
import path from 'path';

const configPath = path.resolve(process.cwd(), 'tailwind.config.ts');
const context = createContext({ configPath });

console.log('Screens:', Object.keys(context.config.theme.screens || {}));
console.log('Content:', context.config.content);
console.log('Has lg:grid-cols-2?', context.getClassList().includes('lg:grid-cols-2'));
console.log('Has grid-cols-2?', context.getClassList().includes('grid-cols-2'));
console.log('Has translate-x-0?', context.getClassList().includes('translate-x-0'));
console.log('Has lg:translate-x-0?', context.getClassList().includes('lg:translate-x-0'));

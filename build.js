import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const banner = `// ==UserScript==
// @name         RichUp.io Grandmaster AI Engine (Modular Edition)
// @namespace    http://tampermonkey.net/
// @version      5.2.0
// @description  Grandmaster-level autonomous AI for RichUp.io with full opponent tracking, auction sniping, Markov risk management, intelligent trading, and room-aware jail strategy.
// @author       haxxor + Grandmaster AI
// @license      GPL-3.0
// @match        https://richup.io/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @inject-into  page
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==
`;

const isWatch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: ['src/index.js'],
    bundle: true,
    outfile: 'dist/RichUpBot.user.js',
    banner: { js: banner },
    format: 'iife',
    target: ['es2020'],
    minify: false,
    sourcemap: false
};

async function runBuild() {
    try {
        if (!fs.existsSync('dist')) {
            fs.mkdirSync('dist', { recursive: true });
        }

        if (isWatch) {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
            console.log('⚡ [esbuild] Watching for file changes in src/...');
        } else {
            await esbuild.build(buildOptions);
            console.log('✅ [esbuild] Build complete -> dist/RichUpBot.user.js');
        }
    } catch (err) {
        console.error('❌ Build failed:', err);
        process.exit(1);
    }
}

runBuild();

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 工具渲染页的独立构建：产物落在 `tools/model-tool/.build/`，
 * 不参与游戏 `vite build`，也不进入安装包。
 *
 * 构建产物放入 bundle，避免与输入模型的资源路径混淆。
 */
export default defineConfig({
  root: resolve(here, 'renderer'),
  base: './',
  publicDir: false,
  build: {
    outDir: resolve(here, '.build'),
    emptyOutDir: true,
    target: 'es2019',
    sourcemap: false,
    assetsDir: 'bundle',
    rollupOptions: {
      output: {
        entryFileNames: 'bundle/[name].js',
        chunkFileNames: 'bundle/[name].js',
        assetFileNames: 'bundle/[name][extname]',
      },
    },
  },
});

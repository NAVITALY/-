import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Автономная сборка: ОДИН html-файл — открывается двойным кликом (file://),
// сервер и Node в рантайме не нужны:
// - base './' — относительные пути к ресурсам (важно для file://);
// - viteSingleFile — весь JS/CSS инлайнится внутрь index.html;
// - VITE_STANDALONE=1 — клиент использует локальный бэкенд (localStorage)
//   и HashRouter вместо BrowserRouter.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: { 'import.meta.env.VITE_STANDALONE': JSON.stringify('1') },
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 6000,
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// basicSsl включает HTTPS на dev-сервере: камера телефона (сканер ШК) доступна
// только в защищённом контексте. При первом открытии браузер покажет
// предупреждение самоподписанного сертификата — его нужно принять («Дополнительно» → «Перейти»).
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});

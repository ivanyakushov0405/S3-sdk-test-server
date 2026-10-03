import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Указываем желаемый порт для npm run dev
    strictPort: true, // Если порт 3000 занят, Vite выдаст ошибку, а не включит случайный порт
  },
  preview: {
    port: 8080, // Указываем отдельный порт для команды npm run preview
  }
});
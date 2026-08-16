import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // `host: true` binds the dev server to every network interface, not just
  // loopback — without it, a phone on the same Wi-Fi can't reach this at
  // all (`localhost:5173` from another device just means that device
  // itself). Dev-only; the production build (Render's static site) is
  // unaffected by anything in this file.
  server: {
    host: true,
  },
})

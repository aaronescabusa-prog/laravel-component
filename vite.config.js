import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [
        laravel({
            input: 'resources/js/main.jsx',
            refresh: true,
        }),
        react(),
    ],
    server: {
        // Pin the dev server to "localhost" so the URLs it advertises (the
        // public/hot file and the <script> tags Blade renders) match the
        // localhost dev origins allowed by the Content-Security-Policy. Left
        // unset, Vite resolves the name itself and on Windows prefers the IPv6
        // loopback, advertising http://[::1]:5173 instead - a different origin
        // to a browser, so CSP blocks the dev server's own scripts.
        host: 'localhost',
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
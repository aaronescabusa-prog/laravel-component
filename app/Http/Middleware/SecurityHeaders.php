<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Attaches defence-in-depth headers to every response.
 *
 * A Content-Security-Policy is only enforced outside local development: the
 * Vite dev server injects an inline React Refresh preamble and talks to the
 * browser over a websocket on :5173, which a strict policy would break.
 */
class SecurityHeaders
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        $response->headers->set('Content-Security-Policy', $this->contentSecurityPolicy());

        // HSTS is only advertised over TLS, otherwise plain-HTTP development
        // would be pinned to a scheme the dev server does not serve.
        if ($request->secure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }

    /**
     * Build the Content-Security-Policy for the current environment.
     *
     * The local policy is relaxed only as far as the Vite dev server needs:
     * it injects an inline React Refresh preamble and talks to the browser over
     * a websocket on the dev port. `default-src` is still declared, so a
     * relaxed script policy does not also mean "no policy at all" during
     * development.
     */
    protected function contentSecurityPolicy(): string
    {
        $directives = [
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ];

        if (app()->environment('local')) {
            // The dev server can be advertised as localhost, 127.0.0.1 or the
            // IPv6 loopback [::1], depending on how the machine resolves the
            // name. A browser treats those as three distinct origins when
            // matching CSP, so all of them have to be allowed or the dev
            // server's own client scripts are blocked and the SPA never boots.
            $dev = implode(' ', [
                'http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173',
                'ws://localhost:5173', 'ws://127.0.0.1:5173', 'ws://[::1]:5173',
                'http://localhost:5174', 'http://127.0.0.1:5174', 'http://[::1]:5174',
                'ws://localhost:5174', 'ws://127.0.0.1:5174', 'ws://[::1]:5174',
            ]);

            return implode('; ', array_merge([
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' {$dev}",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "font-src 'self' data:",
                "connect-src 'self' {$dev}",
            ], $directives));
        }

        return implode('; ', array_merge([
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "upgrade-insecure-requests",
        ], $directives));
    }
}

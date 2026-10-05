<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Step 1 — admin-only gate for the web app (the real security boundary).
 *
 * Sanctum equivalent of a `requireAdmin` JWT middleware: `auth:sanctum` runs
 * first and turns a missing/invalid token into a 401, then this gate turns a
 * valid token held by a non-admin into a 403. The message is generic so it
 * does not leak which roles exist beyond Admin.
 *
 * Deliberately separate from EnsureRole: that middleware consults the roles &
 * permissions settings and can be widened from the settings screen, while this
 * gate reads the account's own role and nothing else. It is the counterpart of
 * EnsureAdmin (used for bulk import); both stay strict and neither is
 * delegable.
 */
class RequireAdmin
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (($user->role ?? null) !== 'Admin') {
            return response()->json([
                'message' => 'You do not have permission to perform this action.',
            ], 403);
        }

        return $next($request);
    }
}

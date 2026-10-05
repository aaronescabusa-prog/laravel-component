<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restrict a route to administrators, with no way to widen it.
 *
 * Deliberately separate from EnsureRole. That middleware consults the roles &
 * permissions settings and merges whatever an administrator has granted into
 * the write list, which is the right behaviour for ordinary CRUD. Bulk account
 * import is not such a permission: it creates many accounts at once, each with
 * a password the importer chooses, so granting it through a settings toggle
 * would hand over a far larger capability than "may add a user". This gate
 * reads the account's own role and nothing else.
 */
class EnsureAdmin
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

        if ($user->role !== 'Admin') {
            return response()->json([
                'message' => 'Only an administrator can perform this action.',
            ], 403);
        }

        return $next($request);
    }
}

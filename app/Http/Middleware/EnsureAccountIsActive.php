<?php

namespace App\Http\Middleware;

use App\Models\UserAccount;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects requests from accounts that are no longer active.
 *
 * Login already refuses suspended and pending accounts, but a token issued
 * before the status changed stays valid until it expires. Without this check a
 * suspended user keeps full access to the API for the lifetime of their token,
 * so the account status is re-verified on every authenticated request.
 */
class EnsureAccountIsActive
{
    /**
     * Seconds a verified status is cached for. A suspension therefore takes
     * effect within this window instead of on the very next request, while
     * the common case (an active account) avoids a query per request.
     */
    private const STATUS_CACHE_SECONDS = 15;

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // Unauthenticated requests are handled by the auth middleware itself.
        if (! $user instanceof UserAccount) {
            return $next($request);
        }

        $status = $this->currentStatus($user);

        if ($status !== 'Active') {
            $this->revokeTokens($user);

            return response()->json([
                'message' => $status === 'Suspended'
                    ? 'Your account has been suspended. Please contact an administrator.'
                    : 'Your account is not active yet.',
                'status' => $status,
            ], 403);
        }

        return $next($request);
    }

    /**
     * The account's current status, refreshed from the database when the cached
     * value is missing or stale. The cache is keyed by the account id and
     * dropped whenever a status is written, so an admin's change is picked up
     * within the cache window.
     */
    private function currentStatus(UserAccount $user): string
    {
        $key = UserAccount::STATUS_CACHE_KEY.$user->getKey();

        $cached = Cache::get($key);

        if (is_string($cached)) {
            return $cached;
        }

        // Re-read from the database: the authenticated instance may predate the
        // change that suspended the account.
        $status = (string) ($user->newQuery()->whereKey($user->getKey())->value('status') ?? 'Suspended');

        Cache::put($key, $status, self::STATUS_CACHE_SECONDS);

        return $status;
    }

    /**
     * Drop every token for an account that is no longer active, so a token
     * captured before the suspension cannot be replayed after it lapses.
     */
    private function revokeTokens(UserAccount $user): void
    {
        $user->tokens()->delete();
    }
}

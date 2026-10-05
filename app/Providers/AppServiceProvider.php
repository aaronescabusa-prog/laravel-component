<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();
        $this->useRequestAwareStorageUrls();
    }

    /**
     * Point the public disk at the origin the request actually came in on.
     *
     * config/filesystems.php falls back to APP_URL, which names exactly one
     * origin. This application is reachable under more than one - the
     * sub-directory install under XAMPP (/laravel-component/public) and the
     * dev server on :8000 - so a fixed APP_URL makes every generated logo,
     * certificate template and certificate PDF link point at whichever origin
     * happened to be configured, and those images break as soon as the other
     * one stops. Resolving against the request keeps the links on the origin
     * the visitor is actually using.
     *
     * Console commands, queued jobs and the test suite have no request to read,
     * so APP_URL stays in force there and those contexts remain deterministic.
     */
    protected function useRequestAwareStorageUrls(): void
    {
        if ($this->app->runningInConsole()) {
            return;
        }

        // Request::root() is the scheme, host and base path (for example
        // "http://localhost/laravel-component/public"), already trimmed.
        config([
            'filesystems.disks.public.url' => request()->root().'/storage',
        ]);
    }

    /**
     * Throttle the public authentication endpoints so passwords cannot be
     * brute forced and accounts cannot be mass registered.
     */
    protected function configureRateLimiting(): void
    {
        RateLimiter::for('login', function (Request $request) {
            $email = (string) $request->input('email');

            return Limit::perMinute(5)
                ->by($email !== '' ? $email.'|'.$request->ip() : (string) $request->ip())
                ->response(fn (Request $request, array $headers) => response()->json([
                    'message' => 'Too many login attempts. Please try again in a minute.',
                ], 429, $headers));
        });

        RateLimiter::for('register', fn (Request $request) => Limit::perMinute(3)
            ->by((string) $request->ip())
            ->response(fn (Request $request, array $headers) => response()->json([
                'message' => 'Too many registration attempts. Please try again in a minute.',
            ], 429, $headers)));

        // A stolen token is a full account takeover, so cap how fast one
        // account can drive the API regardless of how it authenticated.
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(180)
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip()))
            ->response(fn (Request $request, array $headers) => response()->json([
                'message' => 'Too many requests. Please slow down.',
            ], 429, $headers)));
    }
}

<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'role' => \App\Http\Middleware\EnsureRole::class,
            'active' => \App\Http\Middleware\EnsureAccountIsActive::class,
            'admin' => \App\Http\Middleware\EnsureAdmin::class,
            // Step 1 — admin-only gate for the web app. Alias for RequireAdmin;
            // kept distinct from `admin` (EnsureAdmin) so the two strict gates
            // stay independently auditable.
            'requireAdmin' => \App\Http\Middleware\RequireAdmin::class,
        ]);

        $middleware->append(\App\Http\Middleware\SecurityHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })
    ->create();
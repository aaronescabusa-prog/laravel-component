<?php

use App\Models\Registration;
use App\Models\UserAccount;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

/* ------------------------------------------------------- demo data guardrails */

test('the production seeder creates no accounts', function () {
    App::instance('env', 'production');

    Artisan::call('db:seed', ['--class' => DatabaseSeeder::class, '--force' => true]);

    expect(Schema::hasTable('user_accounts'))->toBeTrue();
    expect(UserAccount::count())->toBe(0);
});

test('demo data is skipped unless it is explicitly opted into', function () {
    // Not production, but no SEED_DEMO_DATA set: still skipped.
    putenv('SEED_DEMO_DATA');
    $_ENV['SEED_DEMO_DATA'] = null;
    $_SERVER['SEED_DEMO_DATA'] = null;

    Artisan::call('db:seed', ['--class' => DatabaseSeeder::class, '--force' => true]);

    expect(UserAccount::count())->toBe(0);
});

/* ---------------------------------------------- list endpoints are not truncated */

test('a listing larger than the per-page cap is reachable across pages', function () {
    $admin = UserAccount::create([
        'reference' => 'USR-PAGE-1', 'name' => 'Admin', 'email' => 'page-admin@tmc.test',
        'role' => 'Admin', 'status' => 'Active', 'password' => Hash::make('password123'),
    ]);

    for ($i = 1; $i <= 250; $i++) {
        Registration::create([
            'reference' => 'TMC-'.$i, 'participant' => "P{$i}", 'email' => "p{$i}@tmc.test",
            'event' => 'Event', 'payment' => '100', 'payment_status' => 'Paid',
            'attendance' => 'Present', 'reg_date' => '2026-10-01',
        ]);
    }

    // The client requests 1000 rows but the server caps at 200, so it must
    // follow next_page_url. Walk it exactly like api.js collectAllPages does.
    $first = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/registrations?per_page=1000')->assertOk()->json();

    expect($first['per_page'])->toBe(200)
        ->and($first['total'])->toBe(250)
        ->and($first['data'])->toHaveCount(200)
        ->and($first['next_page_url'])->not->toBeNull();

    // Mirror api.js collectAllPages exactly: follow next_page_url, but re-send
    // the resolved per_page because Laravel omits it from the link.
    $collected = $first['data'];
    $next = $first['next_page_url'];
    $perPage = (string) (int) $first['per_page'];
    $guard = 0;

    while ($next && $guard < 25) {
        $guard++;
        $query = [];
        parse_str((string) parse_url($next, PHP_URL_QUERY), $query);
        $query['per_page'] = $perPage;

        $page = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/registrations?'.http_build_query($query))
            ->assertOk()
            ->json();

        $collected = array_merge($collected, $page['data']);
        $next = $page['next_page_url'];
    }

    // Every row reachable exactly once: no drops AND no overlap.
    expect($collected)->toHaveCount(250);
    expect(array_unique(array_column($collected, 'reference')))->toHaveCount(250);
});
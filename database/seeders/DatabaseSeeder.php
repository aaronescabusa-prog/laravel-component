<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     *
     * Demo data is opt-in and never runs in production: DemoDataSeeder creates
     * an administrator whose password is a published literal in this
     * repository. Running it on a real deployment would hand anyone who has
     * read the source full administrative access to the live system.
     *
     * Opt in explicitly with:
     *     php artisan db:seed --class=DatabaseSeeder
     * or by setting SEED_DEMO_DATA=true in the environment.
     *
     * In production, create the first administrator by hand instead.
     */
    public function run(): void
    {
        if ($this->demoDataBlocked()) {
            $this->command?->warn('Skipping demo data in production. Create an administrator account manually.');

            return;
        }

        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);

        $this->call(DemoDataSeeder::class);
    }

    /**
     * Whether demo data must be skipped for this environment.
     *
     * An explicit `SEED_DEMO_DATA=true` is honoured outside production so a
     * staging or demo host can still be seeded, but never in production.
     */
    private function demoDataBlocked(): bool
    {
        if (app()->environment('production')) {
            return true;
        }

        return ! filter_var(env('SEED_DEMO_DATA', false), FILTER_VALIDATE_BOOLEAN);
    }
}

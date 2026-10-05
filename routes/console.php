<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Send 24-hour event reminders every morning at 08:00.
 * Requires a running queue worker: php artisan queue:work
 * See app/Console/Commands/SendEventReminders.php for details.
 */
Schedule::command('events:send-reminders')->dailyAt('08:00');

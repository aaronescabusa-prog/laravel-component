<?php

namespace App\Console\Commands;

use App\Jobs\SendEventReminderJob;
use App\Models\Event;
use Illuminate\Console\Command;

/**
 * Sends 24-hour event-reminder emails to all active registrations
 * for every Approved event whose event_date is tomorrow.
 *
 * Schedule: daily at 08:00 via the scheduler in routes/console.php.
 * Jobs land on the default queue (QUEUE_CONNECTION=database).
 * A running queue worker is required: php artisan queue:work
 *
 * Usage:
 *   php artisan events:send-reminders           # dry-run safe (jobs are dispatched)
 *   php artisan events:send-reminders --date=2026-10-10  # target a specific date (YYYY-MM-DD)
 */
class SendEventReminders extends Command
{
    protected $signature = 'events:send-reminders
                            {--date= : Target event_date (YYYY-MM-DD). Defaults to tomorrow.}';

    protected $description = 'Dispatch reminder emails for Approved events happening tomorrow';

    public function handle(): int
    {
        $target = $this->option('date')
            ? now()->parse($this->option('date'))->toDateString()
            : now()->addDay()->toDateString();

        $this->info("Sending reminders for events on {$target}…");

        $events = Event::where('status', 'Approved')
            ->whereDate('event_date', $target)
            ->with(['registrations' => function ($q) {
                // Only registrations with a real email address; skip blanks/placeholders.
                $q->where('email', '!=', '')
                  ->whereNotNull('email');
            }])
            ->get();

        if ($events->isEmpty()) {
            $this->info('No approved events found for that date.');
            return self::SUCCESS;
        }

        $dispatched = 0;

        foreach ($events as $event) {
            foreach ($event->registrations as $registration) {
                SendEventReminderJob::dispatch($registration, $event);
                $dispatched++;
            }

            $this->line("  • {$event->title}: dispatched {$event->registrations->count()} reminder(s)");
        }

        $this->info("Done. {$dispatched} reminder job(s) queued.");

        return self::SUCCESS;
    }
}

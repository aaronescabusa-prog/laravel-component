<?php

use App\Jobs\SendEventReminderJob;
use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

/*
|--------------------------------------------------------------------------
| Manual event reminders
|--------------------------------------------------------------------------
|
| The 08:00 sweep (events:send-reminders) covers every registration for
| tomorrow's events. These cover the other path: an operator ticking rows in the
| Registrations screen and queuing reminders by hand.
|
| Helper names are prefixed because Pest shares top-level functions across every
| test file in the suite - makeEvent()/makeRegistration() already exist.
|
*/

function reminderAccount(string $role = 'Admin'): UserAccount
{
    static $seq = 0;
    $seq++;

    return UserAccount::create([
        'reference' => "USR-RMD-{$seq}",
        'name' => "Reminder Tester {$seq}",
        'email' => "reminder{$seq}@tmc.edu.ph",
        'role' => $role,
        'status' => 'Active',
        'password' => 'password',
    ]);
}

function reminderEvent(array $overrides = []): Event
{
    return Event::create(array_merge([
        'reference' => 'EVE-RMD-1',
        'title' => 'Reminders Night',
        'category' => 'Seminar',
        'event_date' => '2026-10-20',
        'status' => 'Approved',
    ], $overrides));
}

function reminderRegistration(string $reference, ?Event $event, array $overrides = []): Registration
{
    // The `event` title column is NOT NULL, so an "eventless" registration
    // keeps a placeholder title while its event_id stays null; the skipped
    // path keys off the missing relation, not the title.
    return Registration::forceCreate(array_merge([
        'reference' => $reference,
        'participant' => 'Participant '.substr($reference, -2),
        'email' => strtolower($reference).'@student.tmc.test',
        'event' => $event?->title ?? 'No Event Attached',
        'event_id' => $event?->id,
        'payment' => 'Free',
        'payment_status' => 'N/A',
        'attendance' => 'Not Yet Recorded',
        'reg_date' => '2026-10-05',
    ], $overrides));
}

/* -------------------------------------------------------------------------- */

test('a reminder is queued for each selected registration', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $event = reminderEvent();
    reminderRegistration('TMC-7001', $event);
    reminderRegistration('TMC-7002', $event);

    $response = $this->postJson('/api/registrations/send-reminders', [
        'references' => ['TMC-7001', 'TMC-7002'],
    ])->assertOk();

    expect($response->json('queued'))->toBe(2)
        ->and($response->json('skipped'))->toBeEmpty();

    Queue::assertPushed(SendEventReminderJob::class, 2);
});

test('a registration with no event attached is skipped rather than failing the batch', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $event = reminderEvent();
    reminderRegistration('TMC-7101', $event);
    reminderRegistration('TMC-7102', null);

    $response = $this->postJson('/api/registrations/send-reminders', [
        'references' => ['TMC-7101', 'TMC-7102'],
    ])->assertOk();

    expect($response->json('queued'))->toBe(1)
        ->and($response->json('skipped'))->toHaveCount(1)
        ->and($response->json('skipped.0.reference'))->toBe('TMC-7102')
        ->and($response->json('skipped.0.reason'))->toContain('No event');

    Queue::assertPushed(SendEventReminderJob::class, 1);
});

test('a registration with an unusable address is skipped and named', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $event = reminderEvent();
    reminderRegistration('TMC-7201', $event);
    reminderRegistration('TMC-7202', $event, ['email' => 'not-an-address']);

    $response = $this->postJson('/api/registrations/send-reminders', [
        'references' => ['TMC-7201', 'TMC-7202'],
    ])->assertOk();

    expect($response->json('queued'))->toBe(1)
        ->and($response->json('skipped.0.reference'))->toBe('TMC-7202')
        ->and($response->json('skipped.0.reason'))->toContain('email');

    Queue::assertPushed(SendEventReminderJob::class, 1);
});

test('an unknown reference is reported instead of being silently dropped', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $event = reminderEvent();
    reminderRegistration('TMC-7301', $event);

    $response = $this->postJson('/api/registrations/send-reminders', [
        'references' => ['TMC-7301', 'TMC-DOES-NOT-EXIST'],
    ])->assertOk();

    expect($response->json('queued'))->toBe(1)
        ->and($response->json('skipped.0.reference'))->toBe('TMC-DOES-NOT-EXIST')
        ->and($response->json('skipped.0.reason'))->toContain('not found');
});

test('a reference repeated in one request is only queued once', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $event = reminderEvent();
    reminderRegistration('TMC-7401', $event);

    $this->postJson('/api/registrations/send-reminders', [
        'references' => ['TMC-7401', 'TMC-7401', 'TMC-7401'],
    ])->assertOk()->assertJsonPath('queued', 1);

    Queue::assertPushed(SendEventReminderJob::class, 1);
});

test('an empty batch is refused outright', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $this->postJson('/api/registrations/send-reminders', ['references' => []])
        ->assertStatus(422);

    Queue::assertNothingPushed();
});

test('a student cannot queue reminders', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Student'));

    $event = reminderEvent();
    reminderRegistration('TMC-7501', $event);

    $this->postJson('/api/registrations/send-reminders', ['references' => ['TMC-7501']])
        ->assertForbidden();

    Queue::assertNothingPushed();
});

test('a staff member may queue reminders', function () {
    Queue::fake();
    Sanctum::actingAs(reminderAccount('Admin'));

    $event = reminderEvent();
    reminderRegistration('TMC-7601', $event);

    $this->postJson('/api/registrations/send-reminders', ['references' => ['TMC-7601']])
        ->assertOk()
        ->assertJsonPath('queued', 1);
});

<?php

use App\Models\Attendance;
use App\Models\AttendanceSession;
use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Services\EventSchedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function checkInStaff(string $role = 'Staff'): UserAccount
{
    // Reused across calls within a test: the punch helper signs a member of
    // staff in each time it runs, and user_accounts.email is unique.
    return UserAccount::firstOrCreate(
        ['email' => strtolower($role).'-desk@tmc.test'],
        [
            'reference' => 'USR-'.$role.'-1', 'name' => 'Check In Desk',
            'role' => $role, 'status' => 'Active', 'password' => 'password',
        ]
    );
}

function checkInStudent(): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-STU-CHK', 'name' => 'Student', 'email' => 'student-desk@tmc.test',
        'role' => 'Student', 'status' => 'Active', 'password' => 'password',
    ]);
}

function checkInEvent(array $overrides = []): Event
{
    return Event::create(array_merge([
        'reference' => 'EVE-CHK-1',
        'title' => 'Tech Fest',
        'category' => 'Seminar',
        'event_date' => '2026-10-05',
        'status' => 'Approved',
        'has_certificate' => true,
    ], $overrides));
}

function checkInAttendee(Event $event, string $participant, int $seq): Registration
{
    return Registration::forceCreate([
        'reference' => 'TMC-'.$seq,
        'participant' => $participant,
        'email' => strtolower(str_replace(' ', '.', $participant)).'@student.tmc.test',
        'event' => $event->title,
        'event_id' => $event->id,
        'payment' => '100',
        'payment_status' => 'Paid',
        'reg_date' => '2026-10-01',
    ]);
}

/**
 * Create the event's sessions and return them keyed by label.
 *
 * @return array<string, AttendanceSession>
 */
function checkInSessions(Event $event): array
{
    app(EventSchedule::class)->ensureSessions($event);

    return $event->attendanceSessions()->get()->keyBy('label')->all();
}

function punch(
    AttendanceSession $session,
    Registration $registration,
    string $direction = 'in',
    ?string $at = '2026-10-05 08:05:00'
): \Illuminate\Testing\TestResponse {
    Sanctum::actingAs(checkInStaff());

    return test()->postJson("/api/checkin/{$session->event->checkin_token}/punch", [
        'session_id' => $session->id,
        'direction' => $direction,
        'registration_ids' => [$registration->id],
        'at' => $at,
    ]);
}

/* ------------------------------------------------------------ authorisation */

test('a check-in needs an authenticated account with the registrations role', function () {
    $event = checkInEvent();

    $this->getJson("/api/checkin/{$event->checkin_token}")
        ->assertUnauthorized();

    Sanctum::actingAs(checkInStudent());

    $this->getJson("/api/checkin/{$event->checkin_token}")->assertForbidden();
});

test('an inactive account cannot check anybody in', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    $staff = checkInStaff();
    $staff->forceFill(['status' => 'Inactive'])->save();

    Sanctum::actingAs($staff);

    $this->postJson("/api/checkin/{$event->checkin_token}/punch", [
        'session_id' => $sessions['Morning']->id,
        'registration_ids' => [$attendee->id],
    ])->assertStatus(403);

    expect($attendee->attendances()->count())->toBe(0);
});

/* ------------------------------------------------------------------- roster */

test('the roster lists every participant with both sessions for the scanned event', function () {
    $event = checkInEvent();
    checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    Sanctum::actingAs(checkInStaff());

    $response = $this->getJson("/api/checkin/{$event->checkin_token}")
        ->assertOk()
        ->assertJsonPath('event.title', 'Tech Fest')
        ->assertJsonPath('sessions.0.label', 'Morning')
        ->assertJsonPath('sessions.1.label', 'Afternoon')
        ->assertJsonPath('roster.0.participant', 'Ana Cruz')
        ->assertJsonPath('counts.registered', 1);

    expect($response->json('roster.0.registration_id'))->toBe($attendee->id)
        // Two sessions are expected, and neither has been punched yet.
        ->and($response->json('roster.0.sessions_total'))->toBe(2)
        ->and($response->json('roster.0.sessions_complete'))->toBe(0)
        ->and($response->json('counts.fully_recorded'))->toBe(0);
});

test('an unknown token is not found', function () {
    Sanctum::actingAs(checkInStaff());

    $this->getJson('/api/checkin/not-a-real-token')->assertNotFound();
});

test('the roster never leaks participants from another event', function () {
    $event = checkInEvent();
    $other = checkInEvent(['reference' => 'EVE-CHK-2', 'title' => 'Other Fest']);

    checkInSessions($event);
    checkInAttendee($event, 'Ana Cruz', 1);
    checkInAttendee($other, 'Ben Diaz', 2);

    Sanctum::actingAs(checkInStaff());

    $response = $this->getJson("/api/checkin/{$event->checkin_token}")->assertOk();

    expect($response->json('roster'))->toHaveCount(1)
        ->and($response->json('roster.0.participant'))->toBe('Ana Cruz');
});

/* ------------------------------------------------------------------- punches */

test('a participant is punched in then out and becomes present', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    punch($sessions['Morning'], $attendee)->assertOk()->assertJsonPath('skipped', []);

    $attendance = $attendee->attendances()->first();
    expect($attendance->status)->toBe(Attendance::PRESENT)
        ->and($attendance->time_in)->not->toBeNull()
        ->and($attendance->time_out)->toBeNull();

    punch($sessions['Morning'], $attendee, 'out', '2026-10-05 11:55:00')->assertOk();

    expect($attendee->attendances()->first()->status)->toBe(Attendance::PRESENT)
        ->and($attendee->attendances()->first()->time_out)->not->toBeNull();
});

test('arriving after the window starts records a late arrival', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    // 08:20 is past the 15 minute grace on an 08:00 window.
    punch($sessions['Morning'], $attendee, 'in', '2026-10-05 08:20:00')->assertOk();

    expect($attendee->attendances()->first()->status)->toBe(Attendance::LATE);
});

test('arriving just inside the grace period is still present', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    punch($sessions['Morning'], $attendee, 'in', '2026-10-05 08:14:00')->assertOk();

    expect($attendee->attendances()->first()->status)->toBe(Attendance::PRESENT);
});

test('a duplicate punch-in is rejected instead of overwriting', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    punch($sessions['Morning'], $attendee)->assertOk();
    punch($sessions['Morning'], $attendee, 'in', '2026-10-05 08:30:00')->assertStatus(207);

    // The original punch survives; the duplicate does not overwrite it.
    expect((string) $attendee->attendances()->first()->time_in)->toStartWith('2026-10-05 08:05');
});

test('a participant cannot be punched out before being punched in', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    // The endpoint is a bulk one, so a rejected punch is reported as skipped
    // with a 207 rather than failing the whole batch.
    punch($sessions['Morning'], $attendee, 'out', '2026-10-05 11:00:00')
        ->assertStatus(207)
        ->assertJsonPath('punched', []);

    expect($attendee->attendances()->first()?->time_out)->toBeNull();
});

test('a session from another event cannot be punched through this event', function () {
    $event = checkInEvent();
    $other = checkInEvent(['reference' => 'EVE-CHK-2', 'title' => 'Other Fest']);

    checkInSessions($event);
    $foreign = checkInSessions($other);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    Sanctum::actingAs(checkInStaff());

    $this->postJson("/api/checkin/{$event->checkin_token}/punch", [
        'session_id' => $foreign['Morning']->id,
        'direction' => 'in',
        'registration_ids' => [$attendee->id],
    ])->assertStatus(404);
});

test('participants from another event cannot be punched through this event', function () {
    $event = checkInEvent();
    $other = checkInEvent(['reference' => 'EVE-CHK-2', 'title' => 'Other Fest']);

    $own = checkInSessions($event);
    $outsider = checkInAttendee($other, 'Ben Diaz', 2);

    Sanctum::actingAs(checkInStaff());

    $this->postJson("/api/checkin/{$event->checkin_token}/punch", [
        'session_id' => $own['Morning']->id,
        'direction' => 'in',
        'registration_ids' => [$outsider->id],
    ])->assertStatus(422);

    expect($outsider->attendances()->count())->toBe(0);
});

/* ---------------------------------------------------------------- the roll-up */

test('the legacy attendance column follows the sessions', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    expect($attendee->fresh()->attendance)->toBe(Attendance::NOT_RECORDED);

    punch($sessions['Morning'], $attendee)->assertOk();
    expect($attendee->fresh()->attendance)->toBe(Attendance::PRESENT);
});

/* ------------------------------------------------------------------- marking */

test('participants can be marked absent in bulk', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);

    $one = checkInAttendee($event, 'Ana Cruz', 1);
    $two = checkInAttendee($event, 'Ben Diaz', 2);

    Sanctum::actingAs(checkInStaff());

    $this->postJson("/api/checkin/{$event->checkin_token}/mark", [
        'session_id' => $sessions['Morning']->id,
        'status' => Attendance::ABSENT,
        'registration_ids' => [$one->id, $two->id],
    ])->assertOk()
        ->assertJsonPath('message', 'Marked 2 participant(s) as Absent.');

    expect($one->attendances()->first()->status)->toBe(Attendance::ABSENT)
        ->and($one->attendances()->first()->time_in)->toBeNull();
});

test('marking rejects a participant who is not on the event', function () {
    $event = checkInEvent();
    $other = checkInEvent(['reference' => 'EVE-CHK-2', 'title' => 'Other Fest']);

    $sessions = checkInSessions($event);
    $outsider = checkInAttendee($other, 'Ben Diaz', 2);

    Sanctum::actingAs(checkInStaff());

    $this->postJson("/api/checkin/{$event->checkin_token}/mark", [
        'session_id' => $sessions['Morning']->id,
        'status' => Attendance::ABSENT,
        'registration_ids' => [$outsider->id],
    ])->assertStatus(422);

    expect($outsider->attendances()->count())->toBe(0);
});

/* ------------------------------------------------------------------ sessions */

test('creating an event gives it a morning and an afternoon session', function () {
    Sanctum::actingAs(checkInStaff('Admin'));

    $this->postJson('/api/events', [
        'reference' => 'EVE-NEW-1',
        'title' => 'Brand New Fest',
        'category' => 'Seminar',
        'event_date' => '2026-11-01',
        'status' => 'Draft',
    ])->assertStatus(201);

    $event = Event::where('reference', 'EVE-NEW-1')->firstOrFail();

    expect($event->attendanceSessions()->pluck('label')->all())
        ->toBe(['Morning', 'Afternoon']);
});

test('a window accepts either HH:MM or HH:MM:SS', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $morning = $sessions['Morning'];

    Sanctum::actingAs(checkInStaff());

    $this->patchJson("/api/sessions/{$morning->id}", ['time_in' => '07:30'])
        ->assertOk()
        ->assertJsonPath('time_in', '07:30:00');

    $this->patchJson("/api/sessions/{$morning->id}", ['time_in' => '07:45:00'])
        ->assertOk()
        ->assertJsonPath('time_in', '07:45:00');
});

test('a window that would strand an existing punch is refused and not saved', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    punch($sessions['Morning'], $attendee)->assertOk();

    Sanctum::actingAs(checkInStaff());

    // 09:00-10:00 would put the existing 08:05 punch outside the window.
    $this->patchJson("/api/sessions/{$sessions['Morning']->id}", [
        'time_in' => '09:00',
        'time_out' => '10:00',
    ])->assertStatus(422);

    expect($sessions['Morning']->fresh()->time_in)->toBe('08:00:00')
        ->and($sessions['Morning']->fresh()->time_out)->toBe('12:00:00');
});

test('closing a session stamps the missing check-out without erasing a late arrival', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);

    $early = checkInAttendee($event, 'Ana Cruz', 1);
    $late = checkInAttendee($event, 'Ben Diaz', 2);

    punch($sessions['Morning'], $early, 'in', '2026-10-05 08:05:00')->assertOk();
    punch($sessions['Morning'], $late, 'in', '2026-10-05 08:40:00')->assertOk();

    Sanctum::actingAs(checkInStaff());

    $this->postJson("/api/sessions/{$sessions['Morning']->id}/close")->assertOk();

    expect($early->attendances()->first()->status)->toBe(Attendance::PRESENT)
        ->and($early->attendances()->first()->time_out)->not->toBeNull()
        // Stamping the closing time says nothing about arrival, so late stays late.
        ->and($late->attendances()->first()->status)->toBe(Attendance::LATE)
        ->and($late->attendances()->first()->time_out)->not->toBeNull();

    $this->postJson("/api/sessions/{$sessions['Morning']->id}/reopen")->assertOk();

    expect($sessions['Morning']->fresh()->status)->toBe('open');
});

/* --------------------------------------------------------- strict completion */

test('attendance is only complete when every session has both punches', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    expect($attendee->hasCompleteAttendance())->toBeFalse();

    foreach (['Morning', 'Afternoon'] as $label) {
        punch($sessions[$label], $attendee)->assertOk();

        // In for the session, but not out of it yet.
        expect($attendee->fresh()->hasCompleteAttendance())->toBeFalse();
    }

    punch($sessions['Morning'], $attendee, 'out', '2026-10-05 11:55:00')->assertOk();
    expect($attendee->fresh()->hasCompleteAttendance())->toBeFalse();

    punch($sessions['Afternoon'], $attendee, 'out', '2026-10-05 16:55:00')->assertOk();

    expect($attendee->fresh()->hasCompleteAttendance())->toBeTrue();
});

test('a morning only participant is not treated as fully attended', function () {
    $event = checkInEvent();
    $sessions = checkInSessions($event);
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    // Fully punched for the morning, and nothing at all for the afternoon.
    punch($sessions['Morning'], $attendee)->assertOk();
    punch($sessions['Morning'], $attendee, 'out', '2026-10-05 11:55:00')->assertOk();

    expect($attendee->attendances()->count())->toBe(1)
        ->and($attendee->fresh()->hasCompleteAttendance())->toBeFalse();
});

test('an event with no sessions makes nobody complete', function () {
    $event = checkInEvent();
    $attendee = checkInAttendee($event, 'Ana Cruz', 1);

    expect($attendee->hasCompleteAttendance())->toBeFalse();
});

/* ------------------------------------------------------------------- poster */

test('the poster exposes the QR target only to staff', function () {
    $event = checkInEvent();

    Sanctum::actingAs(checkInStaff());

    // Events bind routes by reference, not by id.
    $this->getJson("/api/events/{$event->reference}/checkin")
        ->assertOk()
        ->assertJsonPath('token', $event->checkin_token)
        ->assertJsonPath('event.title', 'Tech Fest')
        ->assertJsonPath('url', url('/check-in/'.$event->checkin_token));
});
